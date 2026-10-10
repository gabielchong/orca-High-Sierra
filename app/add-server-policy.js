// Decides whether remote page content may add a server to the OrcaHS list.
// Used by the handler behind Settings → Remote Orca Servers → Connect to a host in the upstream web
// client: that form stores one pairing per origin and would overwrite this server's pairing, so adds
// for another origin are routed here, confirmed natively, recorded in servers.json and switched to.
// Pure function, like clipboard-policy.js; main.js supplies the sender facts and shows the dialog.
const { resolvePairInput } = require('./pair-link')

const MAX_INPUT_LENGTH = 129 * 1024 // upstream PAIRING_INPUT_MAX_CHARACTERS
const MAX_LABEL_LENGTH = 64

function evaluateAddServer({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin, input, name }) {
  if (!senderIsWindow) return { ok: false, reason: 'sender is not the main window' }
  if (!frameIsMain) return { ok: false, reason: 'not the main frame' }
  let origin = null
  try { origin = new URL(String(frameUrl)).origin } catch {}
  if (!allowedOrigin || origin !== allowedOrigin) return { ok: false, reason: 'frame is not the trusted server' }
  const text = typeof input === 'string' ? input : ''
  if (!text.trim()) return { ok: false, reason: 'empty input' }
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'input too long' }
  const r = resolvePairInput(text)
  if (r.error) return { ok: false, reason: r.error }
  if (!r.paired) return { ok: false, reason: 'input carries no pairing code' }
  if (r.scope && r.scope !== 'runtime') return { ok: false, reason: `pairing scope is "${r.scope}", expected "runtime"` }
  const target = new URL(r.url)
  if (target.origin === allowedOrigin) return { ok: false, reason: 'same server; the page handles re-pairing itself' }
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_LABEL_LENGTH) : null
  return { ok: true, url: r.url, origin: target.origin, host: target.host, label }
}

module.exports = { evaluateAddServer, MAX_INPUT_LENGTH }
