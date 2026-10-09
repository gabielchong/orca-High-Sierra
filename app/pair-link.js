// Turns whatever the user pastes into the browser URL the Orca web client understands.
// Accepted inputs:
//   orca://pair?code=<base64url>            (Settings → Remote Orca Servers → "Pair another Orca client")
//   http(s)://host:port/...#code=<base64url> (the browser link printed by `orca serve`)
//   <base64url>                              (the bare pairing code)
//   http(s)://host:port/                     (already-paired server, reconnect from stored environment)
// Shared by the main process and the prompt page, so it has no Node or DOM dependencies.
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.OrcaHsPairLink = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  const CODE_KEYS = ['code', 'pairing', 'pair', 'token']

  function base64UrlToString(input) {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  function decodePayload(code) {
    const parsed = JSON.parse(base64UrlToString(code))
    if (!parsed || typeof parsed.endpoint !== 'string') throw new Error('pairing code has no endpoint')
    return parsed
  }

  function codeFromParams(params) {
    for (const key of CODE_KEYS) {
      const value = params.get(key)
      if (value && value.trim()) return value.trim()
    }
    return null
  }

  // ws://host:port → http://host:port/ ; wss://host → https://host/
  function httpOriginFromEndpoint(endpoint) {
    const url = new URL(endpoint)
    const protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`unsupported endpoint ${url.protocol}`)
    return `${protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}/`
  }

  function resolvePairInput(raw) {
    const input = String(raw || '').trim()
    if (!input) return { error: 'empty input' }
    try {
      if (/^orca:\/\//i.test(input)) {
        const url = new URL(input)
        const host = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase()
        if (host !== 'pair') return { error: `unsupported orca:// link (${host})` }
        const code = codeFromParams(url.searchParams)
        if (!code) return { error: 'orca://pair link has no code' }
        const payload = decodePayload(code)
        return { url: `${httpOriginFromEndpoint(payload.endpoint)}#code=${code}`, scope: payload.scope, paired: true }
      }
      if (/^https?:\/\//i.test(input)) {
        const url = new URL(input)
        const hash = url.hash.replace(/^#/, '')
        const code = codeFromParams(url.searchParams) ||
          (hash.startsWith('orca://pair') ? codeFromParams(new URL(hash).searchParams) : codeFromParams(new URLSearchParams(hash)))
        if (code) {
          const payload = decodePayload(code)
          return { url: `${url.origin}${url.pathname}#code=${code}`, scope: payload.scope, paired: true }
        }
        return { url: `${url.origin}${url.pathname}`, paired: false }
      }
      if (/^[A-Za-z0-9_-]{32,}={0,2}$/.test(input)) {
        const payload = decodePayload(input)
        return { url: `${httpOriginFromEndpoint(payload.endpoint)}#code=${input}`, scope: payload.scope, paired: true }
      }
      return { error: 'not an orca://pair link, server URL or pairing code' }
    } catch (err) {
      return { error: `invalid pairing input: ${err && err.message}` }
    }
  }

  // What may be persisted between launches: the server origin only, never the hash.
  function persistableUrl(url) {
    try { const u = new URL(url); return `${u.origin}${u.pathname}` } catch { return null }
  }

  return { resolvePairInput, persistableUrl }
})
