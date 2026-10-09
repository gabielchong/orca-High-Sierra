// OrcaHS main process: an Electron 26 shell that loads a Remote Orca Server's web UI and nothing else.
const { app, BrowserWindow, Menu, shell, ipcMain, clipboard, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const pkg = require('./package.json')
const { resolvePairInput } = require('./pair-link')
const { createClipboardPolicy } = require('./clipboard-policy')
const servers = require('./servers-store')
const { scrub, safeUrl, truncate } = require('./log-scrub')
const { createNavPolicy } = require('./nav-policy')

const argv = process.argv.slice(1)
const debug = argv.includes('--hs-debug')
if (argv.includes('--version')) {
  process.stdout.write(`${pkg.productName} ${pkg.version} (Electron ${process.versions.electron})\n`)
  app.exit(0)
}
function argValue(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

// ---------------------------------------------------------------------------------------------
// Storage: everything the app writes lives under baseDir, private to the user.
// ---------------------------------------------------------------------------------------------
const baseDir = argValue('base-dir') || path.join(app.getPath('appData'), pkg.productName)
const userData = path.join(baseDir, 'userdata')
const logsDir = path.join(baseDir, 'logs')
for (const dir of [baseDir, userData, logsDir]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(dir, 0o700) } catch {}
}
app.setPath('userData', userData)
app.setPath('sessionData', userData)
app.setPath('logs', logsDir)
app.setPath('crashDumps', path.join(baseDir, 'crashes'))
app.setPath('temp', path.join(baseDir, 'tmp'))
app.commandLine.appendSwitch('disk-cache-dir', path.join(userData, 'cache'))
app.commandLine.appendSwitch('use-mock-keychain')
app.setName(pkg.productName)

// macOS creates a few app-scoped locations outside baseDir for every app (saved window state,
// shader cache, preferences). Remove them on start and quit so the app leaves no trace elsewhere.
// This is best effort: a crash or SIGKILL skips the quit-time pass.
const { execFileSync } = require('child_process')
const bundleId = pkg.bundleId
function sysDir(kind) {
  try { return execFileSync('/usr/bin/getconf', [kind]).toString().trim() } catch { return '' }
}
function cleanupSystemTraces() {
  const targets = []
  const tmp = sysDir('DARWIN_USER_TEMP_DIR'); if (tmp) targets.push(path.join(tmp, `${bundleId}.savedState`))
  const cache = sysDir('DARWIN_USER_CACHE_DIR'); if (cache) targets.push(path.join(cache, bundleId))
  targets.push(path.join(app.getPath('home'), 'Library', 'Saved Application State', `${bundleId}.savedState`))
  for (const t of targets) { try { fs.rmSync(t, { recursive: true, force: true }) } catch {} }
  try { execFileSync('/usr/bin/defaults', ['delete', bundleId], { stdio: 'ignore' }) } catch {}
  try { fs.rmSync(path.join(app.getPath('home'), 'Library', 'Preferences', `${bundleId}.plist`), { force: true }) } catch {}
}

// ---------------------------------------------------------------------------------------------
// Logging: every line is scrubbed of pairing material; file is private and size-bounded.
// ---------------------------------------------------------------------------------------------
const logFile = path.join(logsDir, `session-${Date.now()}.log`)
const LOG_MAX_BYTES = 5 * 1024 * 1024
let logBytes = 0
let logDisabled = false
function log(...parts) {
  if (logDisabled) return
  const line = `${new Date().toISOString()} ${scrub(parts.join(' '))}\n`
  logBytes += line.length
  if (logBytes > LOG_MAX_BYTES) {
    logDisabled = true
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} [log] size limit reached, logging stopped\n`, { mode: 0o600 }) } catch {}
    return
  }
  try { fs.appendFileSync(logFile, line, { mode: 0o600 }) } catch { logDisabled = true }
}

// ---------------------------------------------------------------------------------------------
// Known servers: data/servers.json. Entries hold the launch url (origin + path, never the hash)
// and the origin used for trust decisions.
// ---------------------------------------------------------------------------------------------
const serversFile = path.join(baseDir, 'servers.json')
const legacyUrlFile = path.join(baseDir, 'server-url.txt')
function loadServers() {
  if (!fs.existsSync(serversFile)) return []
  try { return servers.parse(fs.readFileSync(serversFile, 'utf8')) } catch (err) { log(`[servers] load failed: ${err && err.message}`); return [] }
}
function saveServers(list) {
  const tmp = `${serversFile}.tmp`
  try {
    fs.writeFileSync(tmp, servers.serialize(list), { mode: 0o600 })
    fs.renameSync(tmp, serversFile)
    return true
  } catch (err) {
    log(`[servers] save failed: ${err && err.message}`)
    try { fs.rmSync(tmp, { force: true }) } catch {}
    return false
  }
}
let serverList = loadServers()
// One-time migration from the single-server file of pre-0.1 builds; the old file is removed so
// a server the owner removed later cannot come back.
if (!fs.existsSync(serversFile) && fs.existsSync(legacyUrlFile)) {
  try {
    const o = servers.normalizeOrigin(fs.readFileSync(legacyUrlFile, 'utf8').trim())
    if (o) serverList = servers.upsert(serverList, `${o}/`, 0)
    if (saveServers(serverList)) fs.rmSync(legacyUrlFile, { force: true })
  } catch (err) { log(`[servers] migration failed: ${err && err.message}`) }
}

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------
const promptUrl = pathToFileURL(path.join(__dirname, 'prompt.html')).href
const offlineUrl = pathToFileURL(path.join(__dirname, 'offline.html')).href
const navPolicy = createNavPolicy({ shellPages: [promptUrl, offlineUrl] })

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: pkg.productName,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    }
  })
  const wc = win.webContents
  const ses = wc.session

  // Trust state. trustedOrigin changes only here, when the owner picks a server (picker, --url,
  // last-used at startup). pendingTarget keeps the full connect URL (pairing hash included) in
  // memory until the server page has loaded once, so a failed first pairing can be retried.
  let trustedOrigin = null
  let pendingTarget = null
  let lastFailedUrl = null

  function connectTo(input, source) {
    const r = resolvePairInput(input)
    if (r.error) { log(`[connect:${source}] rejected: ${r.error}`); return { ok: false, reason: r.error } }
    if (r.scope && r.scope !== 'runtime') {
      const reason = `pairing scope is "${r.scope}", expected "runtime"`
      log(`[connect:${source}] rejected: ${reason}`)
      return { ok: false, reason }
    }
    trustedOrigin = new URL(r.url).origin
    pendingTarget = r.url
    log(`[connect:${source}] ${safeUrl(r.url)}`)
    win.loadURL(r.url)
    return { ok: true }
  }
  function showPrompt() {
    trustedOrigin = null
    pendingTarget = null
    win.loadFile(path.join(__dirname, 'prompt.html'))
  }
  function showOffline(code, desc) {
    const params = new URLSearchParams({ code: String(code), desc: String(desc || '') })
    win.loadFile(path.join(__dirname, 'offline.html'), { hash: params.toString() })
  }
  function retry() {
    if (pendingTarget) { win.loadURL(pendingTarget); return { ok: true } }
    if (trustedOrigin) {
      const known = serverList.find((s) => s.origin === trustedOrigin)
      win.loadURL(known ? known.url : `${trustedOrigin}/`)
      return { ok: true }
    }
    return { ok: false, reason: 'no server selected' }
  }

  // --- Permissions: deny by default; the trusted server may write the clipboard and go fullscreen.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])
  const deniedOnce = new Set()
  function allowPermission(permission, requestingOrigin) {
    let origin = null
    try { origin = new URL(String(requestingOrigin)).origin } catch {}
    const ok = !!trustedOrigin && origin === trustedOrigin && ALLOWED_PERMISSIONS.has(permission)
    if (!ok) {
      const key = `${permission}@${origin}`
      if (!deniedOnce.has(key)) { deniedOnce.add(key); log(`[permission] denied ${permission} for ${origin}`) }
    }
    return ok
  }
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowPermission(permission, details && details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowPermission(permission, requestingOrigin))
  // No downloads: they would write outside baseDir and nothing in this client needs them.
  ses.on('will-download', (event, item) => {
    event.preventDefault()
    log(`[download] blocked ${safeUrl(item.getURL())}`)
  })

  // --- Navigation: only the trusted server origin and the shell's own pages.
  const guardNavigation = (event, url, what) => {
    const v = navPolicy.allows(url, trustedOrigin)
    if (!v.ok) {
      event.preventDefault()
      log(`[${what}] blocked ${safeUrl(url)}: ${v.reason}`)
    }
  }
  wc.on('will-navigate', (e, url) => guardNavigation(e, url, 'navigate'))
  wc.on('will-redirect', (e, url) => guardNavigation(e, url, 'redirect'))
  wc.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => { if (isMainFrame) lastFailedUrl = null })

  // Links that want a new window: never a new Electron window. http(s) links go to the system
  // browser only after the owner confirms in a native dialog, one at a time.
  let externalDialogOpen = false
  wc.setWindowOpenHandler(({ url }) => {
    let parsed = null
    try { parsed = new URL(url) } catch {}
    if (!parsed || !/^https?:$/.test(parsed.protocol) || externalDialogOpen) {
      log(`[window-open] blocked ${parsed ? parsed.host : 'invalid url'}`)
      return { action: 'deny' }
    }
    externalDialogOpen = true
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Open in Browser', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Open ${parsed.host} in your web browser?`,
      detail: `${parsed.origin}${parsed.pathname}`
    }).then(({ response }) => {
      externalDialogOpen = false
      if (response === 0) { shell.openExternal(url); log(`[window-open] opened ${parsed.host}`) }
      else log(`[window-open] declined ${parsed.host}`)
    }).catch(() => { externalDialogOpen = false })
    return { action: 'deny' }
  })

  // --- Load outcome
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2 || debug) log(`[console:${level}] ${truncate(message)} (${safeUrl(sourceId)}:${line})`)
  })
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = ERR_ABORTED, navigation superseded
    log(`[did-fail-load] ${code} ${desc} ${safeUrl(url)}`)
    if (navPolicy.isShellPage(url)) return
    lastFailedUrl = String(url)
    showOffline(code, desc)
  })
  wc.on('render-process-gone', (_e, d) => {
    log(`[render-process-gone] ${JSON.stringify(d)}`)
    showOffline('renderer', (d && d.reason) || 'renderer exited')
  })
  wc.on('did-finish-load', () => {
    const current = wc.getURL()
    log(`[did-finish-load] ${safeUrl(current)}`)
    if (!/^https?:/.test(current) || current === lastFailedUrl) return
    let origin = null
    try { origin = new URL(current).origin } catch {}
    if (!origin || origin !== trustedOrigin) return
    pendingTarget = null // pairing consumed; the web client keeps it in its own storage
    serverList = servers.upsert(serverList, current)
    saveServers(serverList)
  })

  // --- IPC for the shell's own pages (exact file URLs, main frame, this window only)
  function fromShellPage(event) {
    return event.sender === wc && event.senderFrame === wc.mainFrame && navPolicy.isShellPage(event.senderFrame.url)
  }
  ipcMain.handle('orca-hs:servers-list', (event) => (fromShellPage(event) ? serverList : []))
  ipcMain.handle('orca-hs:servers-remove', async (event, origin) => {
    if (!fromShellPage(event)) return { ok: false, reason: 'not allowed' }
    const o = servers.normalizeOrigin(origin)
    if (!o) return { ok: false, reason: 'invalid origin' }
    let cleared = true
    try { await ses.clearStorageData({ origin: o }) } catch (err) { cleared = false; log(`[servers] clearStorageData failed: ${err && err.message}`) }
    serverList = servers.remove(serverList, o)
    const saved = saveServers(serverList)
    if (trustedOrigin === o) { trustedOrigin = null; pendingTarget = null }
    log(`[servers] removed ${o} cleared=${cleared} saved=${saved}`)
    if (!cleared) return { ok: false, reason: 'removed from the list, but clearing its stored pairing failed; try again' }
    if (!saved) return { ok: false, reason: 'pairing cleared, but saving the server list failed' }
    return { ok: true }
  })
  ipcMain.handle('orca-hs:connect', (event, input) => (fromShellPage(event) ? connectTo(String(input), 'picker') : { ok: false, reason: 'not allowed' }))
  ipcMain.handle('orca-hs:retry', (event) => (fromShellPage(event) ? retry() : { ok: false, reason: 'not allowed' }))
  ipcMain.handle('orca-hs:switch', (event) => { if (fromShellPage(event)) showPrompt(); return { ok: true } })
  ipcMain.handle('orca-hs:state', (event) => (fromShellPage(event) ? { origin: trustedOrigin, pending: !!pendingTarget } : {}))

  // --- Clipboard: the one bridge for remote content. Write-only, policed in clipboard-policy.js.
  const clipboardPolicy = createClipboardPolicy()
  ipcMain.handle('orca-hs:clipboard-write-text', (event, text) => {
    const verdict = clipboardPolicy({
      senderIsWindow: event.sender === wc,
      frameIsMain: event.senderFrame === wc.mainFrame,
      frameUrl: event.senderFrame ? event.senderFrame.url : '',
      allowedOrigin: trustedOrigin,
      text
    })
    if (!verdict.ok) { log(`[clipboard] denied: ${verdict.reason}`); return verdict }
    clipboard.writeText(text)
    log(`[clipboard] wrote ${text.length} chars`)
    return { ok: true }
  })

  // --- Debug aids: periodic screenshots and a fixed capability probe, only with --hs-debug.
  if (debug) {
    for (const delay of [8000, 25000, 60000]) {
      setTimeout(async () => {
        if (win.isDestroyed()) return
        try {
          const img = await wc.capturePage()
          fs.writeFileSync(path.join(logsDir, `shot-${delay}.png`), img.toPNG(), { mode: 0o600 })
          log(`[shot] ${delay}`)
        } catch (err) { log(`[shot-error] ${delay} ${err && err.message}`) }
      }, delay)
    }
    wc.on('did-finish-load', async () => {
      try {
        const r = await wc.executeJavaScript(`(() => ({
          polyfilled: window.__orcaHsPolyfills === true,
          clipboardShim: window.__orcaHsClipboardShim || null,
          clipboardApi: typeof (navigator.clipboard && navigator.clipboard.writeText),
          webgl2: !!document.createElement('canvas').getContext('webgl2'),
          offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
          promiseWithResolvers: typeof Promise.withResolvers,
          secureContext: window.isSecureContext,
          title: document.title,
          dpr: window.devicePixelRatio,
          viewport: [window.innerWidth, window.innerHeight]
        }))()`, true)
        log(`[probe] ${JSON.stringify(r)}`)
      } catch (err) { log(`[probe-error] ${err && err.message}`) }
    })
  }

  // --- Startup target: --prompt → picker; --url → that; else the most recently used server.
  const startInput = argv.includes('--prompt') ? '' : (argValue('url') || (serverList[0] ? serverList[0].url : ''))
  log(`[start] ${pkg.productName} ${pkg.version} electron=${process.versions.electron} chrome=${process.versions.chrome} debug=${debug}`)
  if (!startInput || !connectTo(startInput, 'startup').ok) showPrompt()

  return { win, showPrompt }
}

function buildMenu(showPrompt) {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Switch Server…', accelerator: 'CmdOrCtrl+Shift+S', click: showPrompt },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  cleanupSystemTraces()
  const { showPrompt } = createWindow()
  buildMenu(showPrompt)
})
app.on('will-quit', () => { cleanupSystemTraces(); log('[quit] cleanup done') })
app.on('window-all-closed', () => app.quit())
