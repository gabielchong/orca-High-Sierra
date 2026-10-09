// Removes pairing material and other secrets from anything that goes to the session log.
// Applied to every line, not just the ones we think are risky.
const PATTERNS = [
  // orca://pair?… anywhere (before key=value so the whole query goes)
  [/orca:\/\/pair\?[^\s"'<>]*/gi, 'orca://pair?<redacted>'],
  // key=value forms in URLs, hashes and query strings
  [/([?&#]|\b)(code|pairing|pair|token|devicetoken|access_token|apikey|api_key|secret|password)=([^&\s"'<>]+)/gi, '$1$2=<redacted>'],
  // JSON-ish "deviceToken":"…"
  [/("?(deviceToken|publicKeyB64|token|secret|password)"?\s*:\s*")[^"]*(")/gi, '$1<redacted>$3'],
  // long base64url blobs (pairing payloads are ~300 chars)
  [/\b[A-Za-z0-9_-]{60,}={0,2}\b/g, '<redacted:blob>'],
  // bearer headers
  [/(authorization:\s*bearer\s+)\S+/gi, '$1<redacted>']
]

function scrub(text) {
  let s = String(text)
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep)
  return s
}

// For URLs we only ever need the origin and path.
function safeUrl(url) {
  try {
    const u = new URL(String(url))
    return `${u.origin}${u.pathname}`
  } catch {
    return scrub(String(url).split(/[#?]/)[0])
  }
}

function truncate(text, max = 400) {
  const s = String(text)
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max})` : s
}

module.exports = { scrub, safeUrl, truncate }
