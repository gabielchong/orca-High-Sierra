// Decides which navigations the shell window may perform. Pure, so it can be unit tested.
//   trustedOrigin: the origin of the server the owner chose (set only by the main process)
//   shellPages:    exact file:// URLs of the shell's own pages
function originOf(url) {
  try { return new URL(String(url)).origin } catch { return null }
}

function stripHash(url) {
  try { const u = new URL(String(url)); u.hash = ''; return u.href } catch { return null }
}

function createNavPolicy({ shellPages }) {
  const pages = new Set(shellPages.map((u) => stripHash(u)))
  return {
    isShellPage(url) {
      return pages.has(stripHash(url))
    },
    allows(url, trustedOrigin) {
      if (pages.has(stripHash(url))) return { ok: true, kind: 'shell' }
      const o = originOf(url)
      if (!o || !/^https?:$/.test(new URL(url).protocol)) return { ok: false, reason: 'unsupported scheme' }
      if (!trustedOrigin) return { ok: false, reason: 'no trusted server origin' }
      if (o !== trustedOrigin) return { ok: false, reason: `origin ${o} is not the trusted server` }
      return { ok: true, kind: 'server' }
    }
  }
}

module.exports = { createNavPolicy, originOf }
