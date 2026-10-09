// Orca High Sierra PoC shell: Electron 26 thin client that only loads a remote Orca server URL.
const { app, BrowserWindow, shell } = require('electron')
const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(1)
function argValue(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

// Keep every write inside one directory (owner rule: nothing outside ~/Desktop).
const baseDir = argValue('base-dir') || path.join(app.getPath('home'), 'Desktop', 'OrcaHS-data')
const userData = path.join(baseDir, 'userdata')
const logsDir = path.join(baseDir, 'logs')
for (const dir of [userData, logsDir]) fs.mkdirSync(dir, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', userData)
app.setPath('logs', logsDir)
app.setPath('crashDumps', path.join(baseDir, 'crashes'))
app.setPath('temp', path.join(baseDir, 'tmp'))
app.commandLine.appendSwitch('disk-cache-dir', path.join(userData, 'cache'))
app.commandLine.appendSwitch('use-mock-keychain')


// Owner rule: nothing may remain outside the base directory. macOS itself creates these
// three app-scoped locations (saved window state, Metal shader cache, cfprefsd plist);
// remove them on every start and quit so the machine stays clean.
const { execFileSync } = require('child_process')
function sysDir(kind) {
  try { return execFileSync('/usr/bin/getconf', [kind]).toString().trim() } catch { return '' }
}
const bundleId = 'dev.hs.orca-poc'
function cleanupSystemTraces() {
  const targets = []
  const tmp = sysDir('DARWIN_USER_TEMP_DIR'); if (tmp) targets.push(path.join(tmp, `${bundleId}.savedState`))
  const cache = sysDir('DARWIN_USER_CACHE_DIR'); if (cache) targets.push(path.join(cache, bundleId))
  targets.push(path.join(app.getPath('home'), 'Library', 'Saved Application State', `${bundleId}.savedState`))
  for (const t of targets) { try { fs.rmSync(t, { recursive: true, force: true }) } catch {} }
  try { execFileSync('/usr/bin/defaults', ['delete', bundleId], { stdio: 'ignore' }) } catch {}
  try { fs.rmSync(path.join(app.getPath('home'), 'Library', 'Preferences', `${bundleId}.plist`), { force: true }) } catch {}
}

const logFile = path.join(logsDir, `session-${Date.now()}.log`)
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`
  fs.appendFileSync(logFile, line)
}

const urlFile = path.join(baseDir, 'server-url.txt')
let targetUrl = argValue('url')
if (!targetUrl && fs.existsSync(urlFile)) targetUrl = fs.readFileSync(urlFile, 'utf8').trim()

const promptPage = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><meta charset="utf-8"><title>Orca HS</title>
<body style="font:14px -apple-system,sans-serif;padding:24px;background:#111;color:#eee">
<h2>Orca High Sierra client</h2>
<p>Paste the Orca server browser URL (from <code>orca serve</code> or Settings → Remote Orca Servers), then press Connect.</p>
<input id="u" style="width:100%;padding:8px;font-size:13px" placeholder="http://192.168.1.11:6768/...">
<p><button id="go" style="padding:8px 16px">Connect</button></p>
<p style="opacity:.6">Chromium ${process.versions.chrome} · Electron ${process.versions.electron} · ${process.platform} ${process.arch}</p>
<script>
document.getElementById('go').onclick=()=>{const v=document.getElementById('u').value.trim();if(v)location.href=v+(v.includes('#')?'':'#')+'&orcahs=1'}
</script></body>`)}`

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Orca HS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    }
  })
  const wc = win.webContents
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    log(`[console:${level}] ${message} (${sourceId}:${line})`)
  })
  wc.on('did-fail-load', (_e, code, desc, url) => log(`[did-fail-load] ${code} ${desc} ${String(url).split(/[#?]/)[0]}`))
  wc.on('did-finish-load', () => {
    // Never log the hash or query: the pairing payload carries the runtime token.
    let shown = wc.getURL()
    try { const u = new URL(shown); shown = `${u.origin}${u.pathname}` } catch {}
    log(`[did-finish-load] ${shown}`)
  })
  wc.on('render-process-gone', (_e, d) => log(`[render-process-gone] ${JSON.stringify(d)}`))
  wc.on('will-navigate', (_e, url) => log(`[will-navigate] ${url.split(/[#?]/)[0]}`))
  wc.setWindowOpenHandler(({ url }) => {
    log(`[window-open blocked] ${url}`)
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Periodic screenshots so the run can be verified over SSH without screen access.
  for (const delay of [8000, 25000, 60000]) {
    setTimeout(async () => {
      if (win.isDestroyed()) return
      try {
        const img = await wc.capturePage()
        fs.writeFileSync(path.join(logsDir, `shot-${delay}.png`), img.toPNG())
        log(`[shot] ${delay}`)
      } catch (err) {
        log(`[shot-error] ${delay} ${err && err.message}`)
      }
    }, delay)
  }



  // Fixed capability probe, logged once per load. No external input is executed.
  wc.on('did-finish-load', async () => {
    try {
      const r = await wc.executeJavaScript(`(() => ({
        polyfilled: window.__orcaHsPolyfills === true,
        webgl2: !!document.createElement('canvas').getContext('webgl2'),
        webgl1: !!document.createElement('canvas').getContext('webgl'),
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
        promiseWithResolvers: typeof Promise.withResolvers,
        objectGroupBy: typeof Object.groupBy,
        arrayToSorted: typeof [].toSorted,
        secureContext: window.isSecureContext,
        subtleCrypto: !!(window.crypto && window.crypto.subtle),
        localStorageKeys: Object.keys(localStorage).length,
        title: document.title,
        dpr: window.devicePixelRatio,
        viewport: [window.innerWidth, window.innerHeight]
      }))()`, true)
      log(`[probe] ${JSON.stringify(r)}`)
    } catch (err) {
      log(`[probe-error] ${err && err.message}`)
    }
  })

  log(`[start] electron=${process.versions.electron} chrome=${process.versions.chrome} target=${targetUrl ? 'url' : 'prompt'}`)
  if (targetUrl) {
    // Remember the URL for the next launch, hash (token) included, inside baseDir only.
    fs.writeFileSync(urlFile, targetUrl)
    win.loadURL(targetUrl)
  } else {
    win.loadURL(promptPage)
  }
}

app.whenReady().then(() => { cleanupSystemTraces(); createWindow() })
app.on('will-quit', () => { cleanupSystemTraces(); log('[quit] cleanup done') })
app.on('window-all-closed', () => app.quit())
