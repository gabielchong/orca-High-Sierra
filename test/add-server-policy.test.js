const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateAddServer } = require('../app/add-server-policy')

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

