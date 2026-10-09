// Known-server list kept by the main process in <baseDir>/servers.json.
// Pure functions over a plain array so they can be unit tested; main.js does the file I/O.
function normalizeOrigin(input) {
  try {
    const u = new URL(String(input))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

function labelFor(origin) {
  try { return new URL(origin).host } catch { return String(origin) }
}

function parse(json) {
  try {
    const data = JSON.parse(json)
    const list = Array.isArray(data) ? data : Array.isArray(data && data.servers) ? data.servers : []
    return list
      .filter((s) => s && normalizeOrigin(s.origin))
      .map((s) => ({ origin: normalizeOrigin(s.origin), label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : labelFor(s.origin), lastUsedAt: Number(s.lastUsedAt) || 0 }))
  } catch {
    return []
  }
}

function upsert(list, origin, now = Date.now()) {
  const o = normalizeOrigin(origin)
  if (!o) return list
  const rest = list.filter((s) => s.origin !== o)
  const existing = list.find((s) => s.origin === o)
  return sort([{ origin: o, label: existing ? existing.label : labelFor(o), lastUsedAt: now }, ...rest])
}

function remove(list, origin) {
  const o = normalizeOrigin(origin)
  return list.filter((s) => s.origin !== o)
}

function sort(list) {
  return [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

function serialize(list) {
  return JSON.stringify({ servers: sort(list) }, null, 2)
}

module.exports = { normalizeOrigin, labelFor, parse, upsert, remove, sort, serialize }
