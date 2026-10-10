// Runs before page scripts in the sandboxed renderer.
// 1. Installs polyfills for ES2024 APIs that Chromium 116 lacks but the upstream Orca renderer uses,
//    and a URL shim for orca:// links (see installOrcaHsUrlShim).
// 2. Routes the page's "Connect to a host" form to the OrcaHS server list (see add-server-policy.js)
//    and draws the "Servers on this Mac" card under Settings → Remote Orca Servers.
// 3. On insecure (plain http) origins, where Chromium removes navigator.clipboard entirely, installs a
//    write-only shim: writeText goes through postMessage to this preload, then IPC to the main process,
//    which enforces the policy in clipboard-policy.js. Reads are rejected; use Cmd+V.
// 4. On the shell's own file:// pages only, exposes the small picker API (the main process re-checks
//    the exact page URL on every call).
const { webFrame, ipcRenderer, contextBridge } = require('electron')

const WRITE_CHANNEL = 'orca-hs:clipboard-write-text'
const REQUEST = 'orca-hs:clipboard:request'
const REPLY = 'orca-hs:clipboard:reply'
// Page bridge: the trusted server's page may ask the shell for these, and nothing else. The main
// process re-checks sender, frame and origin on every call.
const PAGE_REQUEST = 'orca-hs:page:request'
const PAGE_REPLY = 'orca-hs:page:reply'
const PAGE_CHANNELS = new Set(['orca-hs:add-server', 'orca-hs:page-servers', 'orca-hs:page-switch', 'orca-hs:page-remove'])
const MAX_PAGE_PAYLOAD_LENGTH = 129 * 1024

// url-shim:start
// Chromium before 127 parses non-special schemes off-spec: `new URL('orca://pair?code=x')` yields
// host '' and pathname '//pair'. The upstream Orca web client requires `hostname === 'pair'` on
// orca://pair links, so a full link pasted into Settings → Remote Orca Servers is rejected with
// "Enter an Orca access link or bare pairing code" while the bare code works. Installed only when
// the engine misparses: the authority is re-parsed through http: and the accessors overridden.
function installOrcaHsUrlShim(global) {
  const Native = global.URL
  try { if (new Native('orca://pair?x=1').hostname === 'pair') return false } catch { return false }
  const SPECIAL = /^(?:https?|wss?|ftp|file):$/i
  const define = (target, name, get, set) =>
    Object.defineProperty(target, name, { get, set: set || (() => {}), enumerable: true, configurable: true })
  class URL extends Native {
    constructor(input, base) {
      super(input, base)
      const scheme = this.protocol
      if (SPECIAL.test(scheme) || this.host !== '' || !String(this.pathname).startsWith('//')) return
      const rest = this.href.slice(scheme.length) // "//pair?code=…"
      const authority = rest.slice(2).split(/[/?#]/)[0]
      if (!authority) return
      let fixed
      try { fixed = new Native('http:' + rest) } catch { return }
      if (fixed.username || fixed.password) return
      const hasPath = rest.slice(2 + authority.length).startsWith('/')
      const pathname = () => (hasPath ? fixed.pathname : '')
      define(this, 'protocol', () => scheme)
      define(this, 'origin', () => 'null')
      define(this, 'host', () => fixed.host, (v) => { fixed.host = v })
      define(this, 'hostname', () => fixed.hostname, (v) => { fixed.hostname = v })
      define(this, 'port', () => fixed.port, (v) => { fixed.port = v })
      define(this, 'pathname', pathname, (v) => { fixed.pathname = v })
      define(this, 'search', () => fixed.search, (v) => { fixed.search = v })
      define(this, 'searchParams', () => fixed.searchParams)
      define(this, 'hash', () => fixed.hash, (v) => { fixed.hash = v })
      define(this, 'href', () => `${scheme}//${fixed.host}${pathname()}${fixed.search}${fixed.hash}`)
    }
    toString() { return this.href }
    toJSON() { return this.href }
  }
  for (const key of ['createObjectURL', 'revokeObjectURL', 'canParse']) {
    if (typeof Native[key] === 'function') URL[key] = Native[key].bind(Native)
  }
  global.URL = URL
  return true
}
// url-shim:end

// servers-card:start
// Draws "Servers on this Mac" under Settings → Remote Orca Servers. The upstream web client lists
// one server per origin; this card lists every server this Mac has paired with (OrcaHS's own list,
// the same one behind Switch Server…). Switching reloads the window on that server. Mounted next to
// the upstream pane whenever it is in the DOM, removed when it goes; if the anchor is not found the
// card simply never shows. Runs in the page's main world with no access beyond askShell.
function installOrcaHsServersCard(askShell) {
  const ANCHOR = '[data-settings-section="remote-server-updates"]'
  const ROOT_ID = 'orca-hs-servers-card'
  let busy = false

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const buttonClass = (pane) => {
    const sample = pane.querySelector('button.text-xs, button[class*="ghost"], button')
    return sample && /inline-flex/.test(sample.className) ? sample.className : 'inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted/40'
  }
  const whenText = (ts) => {
    if (!ts) return ''
    try { return 'last used ' + new Date(ts).toLocaleString() } catch { return '' }
  }

  async function render(card, pane) {
    card.replaceChildren()
    const head = el('div', 'flex items-center justify-between gap-3 px-4 py-3')
    const titles = el('div', 'min-w-0 space-y-0.5')
    titles.append(el('div', 'text-sm font-medium', 'Servers on this Mac'))
    titles.append(el('p', 'text-xs text-muted-foreground', 'Every Orca server this Mac has paired with. Switching reloads this window on that server; the same list is behind Switch Server… (⌘⇧S).'))
    head.append(titles)
    card.append(head)
    const list = el('div', 'divide-y divide-border/50 border-t border-border/50')
    card.append(list)
    const reply = await askShell('orca-hs:page-servers', null)
    if (!reply.ok) { list.append(el('div', 'px-4 py-3 text-xs text-destructive', 'OrcaHS could not read the server list: ' + (reply.reason || 'unknown error'))); return }
    if (!reply.servers.length) { list.append(el('div', 'px-4 py-3 text-sm text-muted-foreground', 'No servers saved.')); return }
    const btnClass = buttonClass(pane)
    for (const s of reply.servers) {
      let host = s.origin
      try { host = new URL(s.origin).host } catch {}
      const row = el('div', 'flex items-center gap-3 px-4 py-3')
      const body = el('div', 'min-w-0 flex-1')
      const line = el('div', 'flex min-w-0 items-center gap-2')
      line.append(el('div', 'truncate text-sm font-medium', s.label || host))
      if (s.current) line.append(el('span', 'rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground', 'Current'))
      body.append(line)
      body.append(el('p', 'truncate text-xs text-muted-foreground', host + (s.lastUsedAt ? ' · ' + whenText(s.lastUsedAt) : '')))
      row.append(body)
      const actions = el('div', 'flex shrink-0 items-center gap-1')
      if (!s.current) {
        const sw = el('button', btnClass, 'Switch')
        sw.type = 'button'
        sw.addEventListener('click', async () => {
          if (busy) return
          busy = true; sw.disabled = true; sw.textContent = 'Switching…'
          const r = await askShell('orca-hs:page-switch', s.origin)
          if (!r.ok) { busy = false; sw.disabled = false; sw.textContent = 'Switch'; alert('OrcaHS could not switch: ' + (r.reason || 'unknown error')) }
        })
        actions.append(sw)
      }
      const rm = el('button', btnClass, 'Remove')
      rm.type = 'button'
      rm.addEventListener('click', async () => {
        if (busy) return
        busy = true; rm.disabled = true
        const r = await askShell('orca-hs:page-remove', s.origin)
        busy = false
        if (r.ok) { render(card, pane); return }
        rm.disabled = false
        if (!r.cancelled) alert('OrcaHS could not remove this server: ' + (r.reason || 'unknown error'))
      })
      actions.append(rm)
      row.append(actions)
      list.append(row)
    }
  }

  function sync() {
    const anchor = document.querySelector(ANCHOR)
    const pane = anchor ? anchor.parentElement : null
    const existing = document.getElementById(ROOT_ID)
    if (!pane) { if (existing) existing.remove(); return }
    if (existing && existing.previousElementSibling === pane) {
      existing.classList.toggle('hidden', pane.classList.contains('hidden'))
      return
    }
    if (existing) existing.remove()
    const card = el('div', 'mt-3 rounded-lg border border-border/50 bg-card/30')
    card.id = ROOT_ID
    card.setAttribute('data-orca-hs', 'servers-card')
    pane.insertAdjacentElement('afterend', card)
    card.classList.toggle('hidden', pane.classList.contains('hidden'))
    render(card, pane)
  }

  const start = () => {
    sync()
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => { scheduled = false; sync() })
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
// servers-card:end

const polyfills = `(() => {
  (${installOrcaHsUrlShim.toString()})(globalThis)
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      let resolve, reject
      const promise = new this((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }
  }
  const groupBy = (items, keyFn, makeTarget, setter) => {
    const out = makeTarget()
    let i = 0
    for (const item of items) {
      const key = keyFn(item, i++)
      setter(out, key, item)
    }
    return out
  }
  if (typeof Object.groupBy !== 'function') {
    Object.groupBy = (items, keyFn) => groupBy(items, keyFn, () => Object.create(null),
      (out, key, item) => { const k = typeof key === 'symbol' ? key : String(key); (out[k] ||= []).push(item) })
  }
  if (typeof Map.groupBy !== 'function') {
    Map.groupBy = (items, keyFn) => groupBy(items, keyFn, () => new Map(),
      (out, key, item) => { if (!out.has(key)) out.set(key, []); out.get(key).push(item) })
  }
  if (typeof Array.fromAsync !== 'function') {
    Array.fromAsync = async function (items, mapFn, thisArg) {
      const out = []
      let i = 0
      const iterable = (items != null && (Symbol.asyncIterator in Object(items) || Symbol.iterator in Object(items)))
        ? items
        : Array.from(items) // array-like
      for await (const item of iterable) out.push(mapFn ? await mapFn.call(thisArg, item, i++) : item)
      return out
    }
  }
  if (typeof URL.canParse !== 'function') {
    URL.canParse = (url, base) => { try { new URL(url, base); return true } catch { return false } }
  }
  if (typeof globalThis.Iterator === 'undefined') {
    // Minimal shim: expose the real %IteratorPrototype% so feature checks like
    // typeof Iterator.prototype.join do not throw ReferenceError. Helper methods are not provided.
    const proto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
    globalThis.Iterator = function Iterator() {}
    globalThis.Iterator.prototype = proto
  }

  // Write-only clipboard shim for insecure contexts. Only installed when the real API is absent.
  // read/readText/write are deliberately left undefined so the upstream renderer's feature checks
  // (navigator.clipboard?.read) skip image paste quietly instead of surfacing an error dialog.
  if (!window.isSecureContext && !('clipboard' in navigator)) {
    const pending = new Map()
    let seq = 0
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.type !== ${JSON.stringify(REPLY)}) return
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve()
      else p.reject(new DOMException(e.data.reason || 'clipboard write rejected', 'NotAllowedError'))
    })
    const clipboard = Object.freeze({
      writeText(text) {
        return new Promise((resolve, reject) => {
          const id = ++seq
          pending.set(id, { resolve, reject })
          window.postMessage({ type: ${JSON.stringify(REQUEST)}, id, text: String(text) }, window.location.origin)
          setTimeout(() => { if (pending.delete(id)) reject(new DOMException('clipboard write timed out', 'NotAllowedError')) }, 5000)
        })
      }
    })
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, enumerable: true })
    window.__orcaHsClipboardShim = 'write-only'
  }
  // Settings → Remote Orca Servers → Connect to a host. The web client stores one pairing per
  // origin, so adding another host from the page would overwrite this server's pairing. Adds for a
  // different origin go to OrcaHS (native confirmation, server list, switch); same-origin adds and
  // everything else on window.api pass through untouched. window.api is assigned by page scripts
  // later, so an accessor wraps it on assignment. Upstream hands out a Proxy whose get trap stubs
  // missing namespaces; wrapping with another delegating Proxy keeps that behaviour.
  if (window.top === window && /^https?:$/.test(location.protocol)) {
    const pendingAsks = new Map()
    let askSeq = 0
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.type !== ${JSON.stringify(PAGE_REPLY)}) return
      const resolve = pendingAsks.get(e.data.id)
      if (!resolve) return
      pendingAsks.delete(e.data.id)
      resolve(e.data.result || { ok: false, reason: 'no result' })
    })
    const askShell = (channel, payload) => new Promise((resolve) => {
      const id = ++askSeq
      pendingAsks.set(id, resolve)
      window.postMessage({ type: ${JSON.stringify(PAGE_REQUEST)}, id, channel, payload }, location.origin)
    })
    const targetOrigin = (input) => {
      try {
        let code = String(input).trim()
        if (code.toLowerCase().startsWith('orca://')) {
          const u = new URL(code)
          code = u.searchParams.get('code') || (u.hash ? u.hash.slice(1) : '')
        }
        if (!code) return null
        let b64 = code.replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4) b64 += '='
        const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
        const endpoint = new URL(JSON.parse(json).endpoint)
        const protocol = endpoint.protocol === 'wss:' ? 'https:' : endpoint.protocol === 'ws:' ? 'http:' : endpoint.protocol
        return protocol + '//' + endpoint.host
      } catch { return null }
    }
    const wrapEnvironments = (envs) => new Proxy(envs, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (prop !== 'verifyAndAddFromPairingCode' || typeof value !== 'function') return value
        return async (args) => {
          const pairingCode = args && args.pairingCode
          const origin = targetOrigin(pairingCode)
          if (!origin || origin === location.origin) return value(args)
          const reply = await askShell('orca-hs:add-server', { name: String((args && args.name) || ''), input: String(pairingCode) })
          if (reply.ok) return new Promise(() => {}) // OrcaHS is navigating to the new server
          const message = reply.cancelled ? 'Cancelled in OrcaHS.' : 'OrcaHS could not add this server: ' + (reply.reason || 'unknown error')
          return { ok: false, kind: 'connection-interrupted', message }
        }
      }
    })
    const wrapApi = (api) => (api && typeof api === 'object')
      ? new Proxy(api, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          return prop === 'runtimeEnvironments' && value && typeof value === 'object' ? wrapEnvironments(value) : value
        }
      })
      : api
    let apiValue
    Object.defineProperty(window, 'api', { configurable: true, enumerable: true, get: () => apiValue, set: (v) => { apiValue = wrapApi(v) } })
    window.__orcaHsAddServerBridge = true
    ;(${installOrcaHsServersCard.toString()})(askShell)
  }
  window.__orcaHsPolyfills = true
})()`

webFrame.executeJavaScript(polyfills).catch(() => {})

// Isolated-world side of the clipboard shim: forward write requests from this document only, and
// only when the document is the top-level frame. Oversized payloads are dropped here before IPC.
const MAX_TEXT_LENGTH = 1024 * 1024
if (window.top === window) {
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return
    const data = e.data
    if (!data || data.type !== REQUEST || typeof data.id !== 'number' || typeof data.text !== 'string') return
    let result
    if (data.text.length > MAX_TEXT_LENGTH) {
      result = { ok: false, reason: 'text exceeds 1 MiB' }
    } else {
      try {
        result = await ipcRenderer.invoke(WRITE_CHANNEL, data.text)
      } catch (err) {
        result = { ok: false, reason: String(err && err.message) }
      }
    }
    window.postMessage({ type: REPLY, id: data.id, ok: !!(result && result.ok), reason: result && result.reason }, window.location.origin)
  })
  // Page bridge requests (add server, servers card). Only allow-listed channels are forwarded; the
  // main process re-checks sender, frame, trusted origin and the payload itself.
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return
    const data = e.data
    if (!data || data.type !== PAGE_REQUEST || typeof data.id !== 'number' || typeof data.channel !== 'string') return
    let result
    if (!PAGE_CHANNELS.has(data.channel)) {
      result = { ok: false, reason: 'unknown channel' }
    } else if (JSON.stringify(data.payload === undefined ? null : data.payload).length > MAX_PAGE_PAYLOAD_LENGTH) {
      result = { ok: false, reason: 'payload too long' }
    } else {
      try {
        result = await ipcRenderer.invoke(data.channel, data.payload)
      } catch (err) {
        result = { ok: false, reason: String(err && err.message) }
      }
    }
    const safe = result && typeof result === 'object' ? result : { ok: false, reason: 'no result' }
    window.postMessage({ type: PAGE_REPLY, id: data.id, result: safe }, window.location.origin)
  })
}

// Picker bridge for the shell's own pages. Remote (http) content never sees it; the main process
// additionally verifies the exact page URL on every call.
const isShellPage = window.location.protocol === 'file:' && /\/(prompt|offline|toast)\.html$/.test(decodeURIComponent(window.location.pathname))
if (isShellPage && window.top === window) {
  contextBridge.exposeInMainWorld('orcaHs', {
    listServers: () => ipcRenderer.invoke('orca-hs:servers-list'),
    removeServer: (origin) => ipcRenderer.invoke('orca-hs:servers-remove', String(origin)),
    connect: (input) => ipcRenderer.invoke('orca-hs:connect', String(input)),
    retry: () => ipcRenderer.invoke('orca-hs:retry'),
    switchServer: () => ipcRenderer.invoke('orca-hs:switch'),
    state: () => ipcRenderer.invoke('orca-hs:state'),
    openRelease: () => ipcRenderer.invoke('orca-hs:open-release'),
    updateState: () => ipcRenderer.invoke('orca-hs:update-state'),
    updateInstall: () => ipcRenderer.invoke('orca-hs:update-install'),
    updateDismiss: () => ipcRenderer.invoke('orca-hs:update-dismiss'),
    onUpdateProgress: (cb) => { ipcRenderer.on('orca-hs:update-progress', (_e, payload) => cb(payload)) }
  })
}
