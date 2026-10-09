// Runs before page scripts in the sandboxed renderer. Installs polyfills for ES2024 APIs
// that Chromium 116 lacks but the upstream Orca renderer uses, in the page's main world.
const { webFrame } = require('electron')

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
      (out, key, item) => { (out[key] ||= []).push(item) })
  }
  if (typeof Map.groupBy !== 'function') {
    Map.groupBy = (items, keyFn) => groupBy(items, keyFn, () => new Map(),
      (out, key, item) => { if (!out.has(key)) out.set(key, []); out.get(key).push(item) })
  }
  if (typeof Array.fromAsync !== 'function') {
    Array.fromAsync = async function (items, mapFn, thisArg) {
      const out = []
      let i = 0
      for await (const item of items) out.push(mapFn ? await mapFn.call(thisArg, item, i++) : item)
      return out
    }
  }
  if (typeof URL.canParse !== 'function') {
    URL.canParse = (url, base) => { try { new URL(url, base); return true } catch { return false } }
  }
  if (typeof globalThis.Iterator === 'undefined') {
    // Minimal shim: expose the real %IteratorPrototype% so feature checks like
    // typeof Iterator.prototype.join do not throw ReferenceError.
    const proto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
    globalThis.Iterator = function Iterator() {}
    globalThis.Iterator.prototype = proto
  }
  window.__orcaHsPolyfills = true
})()`

webFrame.executeJavaScript(polyfills).catch(() => {})
