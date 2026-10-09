const test = require('node:test')
const assert = require('node:assert/strict')
const { scrub, safeUrl, truncate } = require('../app/log-scrub')

const blob = 'eyJ2IjoyLCJlbmRwb2ludCI6IndzOi8vMTkyLjAuMi4xMDo2NzY4IiwiZGV2aWNlVG9rZW4iOiJhYmMifQ'

test('scrubs pairing codes in urls, hashes and orca links', () => {
  assert.equal(scrub(`http://h:6768/#code=${blob}`), 'http://h:6768/#code=<redacted>')
  assert.equal(scrub(`orca://pair?code=${blob}`), 'orca://pair?<redacted>')
  assert.equal(scrub(`loaded ?token=abc123 ok`), 'loaded ?token=<redacted> ok')
})

test('scrubs json tokens and long blobs', () => {
  assert.equal(scrub('{"deviceToken":"c29b2f","x":1}'), '{"deviceToken":"<redacted>","x":1}')
  assert.match(scrub(`payload ${blob} end`), /<redacted:blob>/)
})

test('leaves ordinary text alone', () => {
  const s = 'xterm.js: task queue exceeded allotted deadline by 46ms (http://h:6768/assets/a.js:6)'
  assert.equal(scrub(s), s)
})

test('safeUrl keeps origin and path only', () => {
  assert.equal(safeUrl(`http://h:6768/web-index.html?x=1#code=${blob}`), 'http://h:6768/web-index.html')
  assert.equal(safeUrl('not a url #code=zzz'), 'not a url ')
})

test('truncate caps long console messages', () => {
  assert.equal(truncate('a'.repeat(10), 4), 'aaaa…(+6)')
})
