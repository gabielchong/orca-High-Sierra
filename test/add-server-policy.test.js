const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateAddServer, evaluatePageSender, evaluatePageServerAction } = require('../app/add-server-policy')

const code = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const remote = `orca://pair?code=${code({ endpoint: 'ws://10.0.0.5:6768', scope: 'runtime' })}`
const same = `orca://pair?code=${code({ endpoint: 'ws://192.168.1.11:6768', scope: 'runtime' })}`
const mobile = `orca://pair?code=${code({ endpoint: 'ws://10.0.0.5:6768', scope: 'mobile' })}`
const good = { senderIsWindow: true, frameIsMain: true, frameUrl: 'http://192.168.1.11:6768/', allowedOrigin: 'http://192.168.1.11:6768', input: remote, name: ' Linux box ' }

test('add-server: accepts a runtime pairing link for another origin and keeps the name as label', () => {
  const r = evaluateAddServer(good)
  assert.equal(r.ok, true)
  assert.equal(r.origin, 'http://10.0.0.5:6768')
  assert.equal(r.host, '10.0.0.5:6768')
  assert.equal(r.label, 'Linux box')
  assert.ok(r.url.startsWith('http://10.0.0.5:6768/#code='))
  assert.equal(evaluateAddServer({ ...good, name: '' }).label, null)
  assert.equal(evaluateAddServer({ ...good, input: remote.split('code=')[1] }).ok, true) // bare code
})

test('add-server: only the trusted server page in the main frame of the main window may ask', () => {
  assert.equal(evaluateAddServer({ ...good, senderIsWindow: false }).ok, false)
  assert.equal(evaluateAddServer({ ...good, frameIsMain: false }).ok, false)
  assert.equal(evaluateAddServer({ ...good, frameUrl: 'http://evil.example/' }).ok, false)
  assert.equal(evaluateAddServer({ ...good, allowedOrigin: null }).ok, false)
  assert.equal(evaluateAddServer({ ...good, frameUrl: 'file:///prompt.html' }).ok, false)
})

test('add-server: rejects same-origin, non-runtime, unpaired, empty and oversized input', () => {
  assert.match(evaluateAddServer({ ...good, input: same }).reason, /same server/)
  assert.match(evaluateAddServer({ ...good, input: mobile }).reason, /scope/)
  assert.match(evaluateAddServer({ ...good, input: 'http://10.0.0.5:6768/' }).reason, /no pairing code/)
  assert.equal(evaluateAddServer({ ...good, input: '' }).ok, false)
  assert.equal(evaluateAddServer({ ...good, input: undefined }).ok, false)
  assert.equal(evaluateAddServer({ ...good, input: 'x'.repeat(130 * 1024) }).reason, 'input too long')
  assert.equal(evaluateAddServer({ ...good, input: 'orca://pair?code=XXX' }).ok, false)
})

const servers = [
  { origin: 'http://192.168.1.11:6768', url: 'http://192.168.1.11:6768/', label: 'macbookpro', lastUsedAt: 2 },
  { origin: 'http://10.0.0.5:6768', url: 'http://10.0.0.5:6768/', label: 'Linux box', lastUsedAt: 1 }
]
const sender = { senderIsWindow: true, frameIsMain: true, frameUrl: 'http://192.168.1.11:6768/settings', allowedOrigin: 'http://192.168.1.11:6768' }

test('page sender: trusted server page in the main frame only', () => {
  assert.deepEqual(evaluatePageSender(sender), { ok: true, origin: 'http://192.168.1.11:6768' })
  assert.equal(evaluatePageSender({ ...sender, senderIsWindow: false }).ok, false)
  assert.equal(evaluatePageSender({ ...sender, frameIsMain: false }).ok, false)
  assert.equal(evaluatePageSender({ ...sender, frameUrl: 'http://10.0.0.5:6768/' }).ok, false)
  assert.equal(evaluatePageSender({ ...sender, allowedOrigin: null }).ok, false)
})

test('page server action: only known servers, and tells current from other', () => {
  const other = evaluatePageServerAction({ ...sender, origin: 'http://10.0.0.5:6768', servers })
  assert.equal(other.ok, true)
  assert.equal(other.current, false)
  assert.equal(other.server.url, 'http://10.0.0.5:6768/')
  const current = evaluatePageServerAction({ ...sender, origin: 'http://192.168.1.11:6768/', servers })
  assert.equal(current.ok, true)
  assert.equal(current.current, true)
  assert.match(evaluatePageServerAction({ ...sender, origin: 'http://evil.example:6768', servers }).reason, /not a known/)
  assert.match(evaluatePageServerAction({ ...sender, origin: 'nonsense', servers }).reason, /invalid origin/)
  assert.equal(evaluatePageServerAction({ ...sender, frameIsMain: false, origin: 'http://10.0.0.5:6768', servers }).ok, false)
  assert.equal(evaluatePageServerAction({ ...sender, origin: 'http://10.0.0.5:6768', servers: [] }).ok, false)
})
