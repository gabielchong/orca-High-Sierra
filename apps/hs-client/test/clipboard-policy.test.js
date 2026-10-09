const test = require('node:test')
const assert = require('node:assert/strict')
const { createClipboardPolicy, MAX_WRITES_PER_WINDOW, WINDOW_MS } = require('../app/clipboard-policy')

const good = {
  senderIsWindow: true,
  frameIsMain: true,
  frameUrl: 'http://192.168.1.11:6768/',
  allowedOrigin: 'http://192.168.1.11:6768',
  text: 'hello'
}

test('allows a write from the server origin main frame', () => {
  assert.deepEqual(createClipboardPolicy()(good), { ok: true })
})

test('denies other senders, subframes, wrong origins and bad payloads', () => {
  const p = createClipboardPolicy()
  assert.match(p({ ...good, senderIsWindow: false }).reason, /sender/)
  assert.match(p({ ...good, frameIsMain: false }).reason, /main frame/)
  assert.match(p({ ...good, frameUrl: 'http://192.168.1.11:6769/' }).reason, /not the server origin/)
  assert.match(p({ ...good, frameUrl: 'http://evil.example/' }).reason, /not the server origin/)
  assert.match(p({ ...good, frameUrl: 'not a url' }).reason, /invalid/)
  assert.match(p({ ...good, allowedOrigin: null }).reason, /no server origin/)
  assert.match(p({ ...good, text: 42 }).reason, /not a string/)
  assert.match(p({ ...good, text: 'x'.repeat(1024 * 1024 + 1) }).reason, /1 MiB/)
})

test('rate limits bursts and recovers after the window', () => {
  let t = 0
  const p = createClipboardPolicy({ now: () => t })
  for (let i = 0; i < MAX_WRITES_PER_WINDOW; i++) assert.equal(p(good).ok, true)
  assert.match(p(good).reason, /rate limit/)
  t += WINDOW_MS + 1
  assert.equal(p(good).ok, true)
})
