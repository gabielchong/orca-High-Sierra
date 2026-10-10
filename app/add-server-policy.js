// Decides what remote page content may ask the shell to do with the OrcaHS server list.
// Used by the handler behind Settings → Remote Orca Servers → Connect to a host in the upstream web
// client: that form stores one pairing per origin and would overwrite this server's pairing, so adds
// for another origin are routed here, confirmed natively, recorded in servers.json and switched to.
// Pure function, like clipboard-policy.js; main.js supplies the sender facts and shows the dialog.
const { resolvePairInput } = require('./pair-link')

const MAX_INPUT_LENGTH = 129 * 1024 // upstream PAIRING_INPUT_MAX_CHARACTERS
const MAX_LABEL_LENGTH = 64

// The only remote content allowed to talk to the shell: the trusted server's page, main frame, main window.
function evaluatePageSender({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin }) {
  if (!senderIsWindow) return { ok: false, reason: 'sender is not the main window' }
  if (!frameIsMain) return { ok: false, reason: 'not the main frame' }
  let origin = null
  try { origin = new URL(String(frameUrl)).origin } catch {}
  if (!allowedOrigin || origin !== allowedOrigin) return { ok: false, reason: 'frame is not the trusted server' }
  return { ok: true, origin }
}

// Settings card "Servers on this Mac": switching or removing is limited to servers already in the list.
function evaluatePageServerAction({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin, origin, servers }) {
  const sender = evaluatePageSender({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin })
  if (!sender.ok) return sender
  let target = null
  try { target = new URL(String(origin)).origin } catch {}
  if (!target) return { ok: false, reason: 'invalid origin' }
  const known = (servers || []).find((s) => s.origin === target)
  if (!known) return { ok: false, reason: 'not a known server' }
  return { ok: true, server: known, current: target === allowedOrigin }
}

function evaluateAddServer({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin, input, name }) {
  const sender = evaluatePageSender({ senderIsWindow, frameIsMain, frameUrl, allowedOrigin })
  if (!sender.ok) return sender
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

module.exports = { evaluatePageSender, evaluatePageServerAction, evaluateAddServer, MAX_INPUT_LENGTH }
