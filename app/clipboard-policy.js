// Policy for the one privileged bridge the shell offers to remote content: clipboard writeText.
// Pure function so it can be unit tested; main.js supplies the facts about the request.
const MAX_TEXT_LENGTH = 1024 * 1024
const MAX_WRITES_PER_WINDOW = 20
const WINDOW_MS = 10_000

function createClipboardPolicy({ now = () => Date.now() } = {}) {
  const recent = []
  return function evaluate({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin, text }) {
    if (!senderIsWindow) return { ok: false, reason: 'sender is not the client window' }
    if (!frameIsMain) return { ok: false, reason: 'sender frame is not the main frame' }
    if (!allowedOrigin) return { ok: false, reason: 'no server origin is active' }
    let origin
    try { origin = new URL(frameUrl).origin } catch { return { ok: false, reason: 'frame url is invalid' } }
    if (origin !== allowedOrigin) return { ok: false, reason: `origin ${origin} is not the server origin` }
    if (typeof text !== 'string') return { ok: false, reason: 'text is not a string' }
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'text exceeds 1 MiB' }
    const t = now()
    while (recent.length && t - recent[0] > WINDOW_MS) recent.shift()
    if (recent.length >= MAX_WRITES_PER_WINDOW) return { ok: false, reason: 'rate limit exceeded' }
    recent.push(t)
    return { ok: true }
  }
}

module.exports = { createClipboardPolicy, MAX_TEXT_LENGTH, MAX_WRITES_PER_WINDOW, WINDOW_MS }
