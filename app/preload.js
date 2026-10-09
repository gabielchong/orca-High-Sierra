// Runs before page scripts in the sandboxed renderer.
// 1. Installs polyfills for ES2024 APIs that Chromium 116 lacks but the upstream Orca renderer uses.
// 2. On insecure (plain http) origins, where Chromium removes navigator.clipboard entirely, installs a
//    write-only shim: writeText goes through postMessage to this preload, then IPC to the main process,
//    which enforces the policy in clipboard-policy.js. Reads are rejected; use Cmd+V.
// 3. On the shell's own file:// pages only, exposes the small picker API (the main process re-checks
//    the exact page URL on every call).
const { webFrame, ipcRenderer, contextBridge } = require('electron')

const WRITE_CHANNEL = 'orca-hs:clipboard-write-text'
const REQUEST = 'orca-hs:clipboard:request'
const REPLY = 'orca-hs:clipboard:reply'

const polyfills = `(() => {
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
}

// Picker bridge for the shell's own pages. Remote (http) content never sees it; the main process
// additionally verifies the exact page URL on every call.
const isShellPage = window.location.protocol === 'file:' && /\/(prompt|offline)\.html$/.test(decodeURIComponent(window.location.pathname))
if (isShellPage && window.top === window) {
  contextBridge.exposeInMainWorld('orcaHs', {
    listServers: () => ipcRenderer.invoke('orca-hs:servers-list'),
    removeServer: (origin) => ipcRenderer.invoke('orca-hs:servers-remove', String(origin)),
    connect: (input) => ipcRenderer.invoke('orca-hs:connect', String(input)),
    retry: () => ipcRenderer.invoke('orca-hs:retry'),
    switchServer: () => ipcRenderer.invoke('orca-hs:switch'),
    state: () => ipcRenderer.invoke('orca-hs:state')
  })
}
