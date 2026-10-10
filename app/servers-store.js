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

// Launch url: origin + path, never query or hash (which may carry the pairing code).
function launchUrlOf(input) {
  try {
    const u = new URL(String(input))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

function parse(json) {
  try {
    const data = JSON.parse(json)
    const list = Array.isArray(data) ? data : Array.isArray(data && data.servers) ? data.servers : []
    return list
      .filter((s) => s && normalizeOrigin(s.origin))
      .map((s) => {
        const origin = normalizeOrigin(s.origin)
        const url = launchUrlOf(s.url) && launchUrlOf(s.url).startsWith(origin) ? launchUrlOf(s.url) : `${origin}/`
        return { origin, url, label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : labelFor(origin), lastUsedAt: Number(s.lastUsedAt) || 0 }
      })
  } catch {
    return []
  }
}

// `input` is any URL on the server (hash and query are dropped); one entry per origin.
function upsert(list, input, now = Date.now(), label = null) {
  const o = normalizeOrigin(input)
  const url = launchUrlOf(input)
  if (!o || !url) return list
  const rest = list.filter((s) => s.origin !== o)
  const existing = list.find((s) => s.origin === o)
  const wanted = typeof label === 'string' && label.trim() ? label.trim().slice(0, 64) : null
  return sort([{ origin: o, url, label: wanted || (existing ? existing.label : labelFor(o)), lastUsedAt: now }, ...rest])
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

module.exports = { normalizeOrigin, launchUrlOf, labelFor, parse, upsert, remove, sort, serialize }
