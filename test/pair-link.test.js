const test = require('node:test')
const assert = require('node:assert/strict')
const { resolvePairInput, persistableUrl } = require('../app/pair-link')

const payload = { v: 2, endpoint: 'ws://192.0.2.10:6768', deviceToken: 'abc', publicKeyB64: 'k=', pairedDeviceId: 'id', scope: 'runtime' }
const code = Buffer.from(JSON.stringify(payload)).toString('base64url')
const expected = `http://192.0.2.10:6768/#code=${code}`

test('orca://pair link', () => {
  const r = resolvePairInput(`orca://pair?code=${code}`)
  assert.equal(r.url, expected)
  assert.equal(r.scope, 'runtime')
  assert.equal(r.paired, true)
})

test('browser pairing URL with hash keeps the scope', () => {
  const r = resolvePairInput(`http://192.0.2.10:6768/#code=${code}`)
  assert.equal(r.url, expected)
  assert.equal(r.scope, 'runtime')
})

test('browser pairing URL with orca:// inside the hash', () => {
  assert.equal(resolvePairInput(`http://192.0.2.10:6768/#orca://pair?code=${code}`).url, expected)
})

test('bare code', () => {
  assert.equal(resolvePairInput(code).url, expected)
})

test('plain server URL keeps origin only', () => {
  const r = resolvePairInput('http://192.0.2.10:6768/?x=1')
  assert.equal(r.url, 'http://192.0.2.10:6768/')
  assert.equal(r.paired, false)
})

test('wss endpoint under a reverse-proxy prefix', () => {
  const p = { ...payload, endpoint: 'wss://orca.example.com/orca' }
  const c = Buffer.from(JSON.stringify(p)).toString('base64url')
  assert.equal(resolvePairInput(`orca://pair?code=${c}`).url, `https://orca.example.com/orca/#code=${c}`)
})

test('rejects junk', () => {
  assert.match(resolvePairInput('hello world').error, /not an orca/)
  assert.match(resolvePairInput('orca://other?code=x').error, /unsupported/)
  assert.match(resolvePairInput('orca://pair?code=bm90anNvbg').error, /invalid/)
  assert.equal(resolvePairInput('   ').error, 'empty input')
})

test('persistableUrl strips the hash', () => {
  assert.equal(persistableUrl(expected), 'http://192.0.2.10:6768/')
})
