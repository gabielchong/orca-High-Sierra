const test = require('node:test')
const assert = require('node:assert/strict')
const { createNavPolicy } = require('../app/nav-policy')

const shell = ['file:///Applications/Old%20Apps/OrcaHS.app/Contents/Resources/app/prompt.html', 'file:///Applications/Old%20Apps/OrcaHS.app/Contents/Resources/app/offline.html']
const policy = createNavPolicy({ shellPages: shell })
const trusted = 'http://192.0.2.10:6768'

test('allows the trusted server and its sub-paths', () => {
  assert.equal(policy.allows('http://192.0.2.10:6768/#code=x', trusted).ok, true)
  assert.equal(policy.allows('http://192.0.2.10:6768/web-index.html', trusted).ok, true)
})

test('blocks other origins, other ports and non-http schemes', () => {
  assert.match(policy.allows('http://evil.example/', trusted).reason, /not the trusted/)
  assert.match(policy.allows('http://192.0.2.10:6769/', trusted).reason, /not the trusted/)
  assert.match(policy.allows('https://192.0.2.10:6768/', trusted).reason, /not the trusted/)
  assert.match(policy.allows('javascript:alert(1)', trusted).reason, /scheme/)
  assert.match(policy.allows('file:///etc/passwd', trusted).reason, /scheme/)
})

test('blocks everything but shell pages when no server is trusted', () => {
  assert.match(policy.allows('http://192.0.2.10:6768/', null).reason, /no trusted/)
  assert.equal(policy.allows(shell[0] + '#origin=x', null).ok, true)
})

test('shell pages match exactly, including encoded spaces, ignoring the hash', () => {
  assert.equal(policy.isShellPage(shell[1] + '#code=-102'), true)
  assert.equal(policy.isShellPage('file:///Applications/Old%20Apps/OrcaHS.app/Contents/Resources/app/evil.html'), false)
  assert.equal(policy.isShellPage('file:///Applications/Old%20Apps/OrcaHS.app/Contents/Resources/app/'), false)
})
