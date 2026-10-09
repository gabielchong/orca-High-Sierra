const test = require('node:test')
const assert = require('node:assert/strict')
const { compareVersions, parseLatestRelease, shouldCheck, isNewer, expectedSha256, CHECK_INTERVAL_MS, STARTUP_INTERVAL_MS } = require('../app/update-check')

test('compareVersions orders semver and treats pre-releases as older', () => {
  assert.ok(compareVersions('0.1.1', '0.1.0') > 0)
  assert.ok(compareVersions('v0.2.0', '0.1.9') > 0)
  assert.ok(compareVersions('1.0.0', '0.9.9') > 0)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.ok(compareVersions('0.1.1-rc.1', '0.1.1') < 0)
  assert.equal(compareVersions('garbage', '0.1.0'), 0)
})

test('parseLatestRelease accepts only a real release under this repo', () => {
  const ok = parseLatestRelease({ tag_name: 'v0.1.1', html_url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/v0.1.1', name: 'OrcaHS 0.1.1' })
  assert.deepEqual(ok, { version: '0.1.1', url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/v0.1.1', name: 'OrcaHS 0.1.1', zip: null, sums: null })
  assert.equal(parseLatestRelease({ tag_name: 'v0.1.1', html_url: 'https://evil.example/x' }), null)
  assert.equal(parseLatestRelease({ tag_name: 'v0.1.1', html_url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/v0.1.1', prerelease: true }), null)
  assert.equal(parseLatestRelease({ tag_name: 'nope', html_url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/x' }), null)
  assert.equal(parseLatestRelease('not json'), null)
  assert.equal(parseLatestRelease(JSON.stringify({ tag_name: 'v2.0.0', html_url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/v2.0.0' })).version, '2.0.0')
})

test('shouldCheck honours the interval and the disabled flag', () => {
  const now = 1_000_000_000_000
  assert.equal(shouldCheck({}, now), true)
  assert.equal(shouldCheck({ lastCheckedAt: now - 1000 }, now), false)
  assert.equal(shouldCheck({ lastCheckedAt: now - CHECK_INTERVAL_MS - 1 }, now), true)
  assert.equal(shouldCheck({ disabled: true }, now), false)
  assert.equal(shouldCheck(null, now), false)
  // launch-time check: a check from earlier today must not suppress it, only a check within the last minute does
  assert.equal(shouldCheck({ lastCheckedAt: now - 2 * 60 * 60 * 1000 }, now, STARTUP_INTERVAL_MS), true)
  assert.equal(shouldCheck({ lastCheckedAt: now - 10 * 1000 }, now, STARTUP_INTERVAL_MS), false)
})

test('isNewer', () => {
  assert.equal(isNewer('0.1.1', '0.1.0'), true)
  assert.equal(isNewer('0.1.0', '0.1.0'), false)
})

test('parseLatestRelease picks the zip and checksum assets only from this repo', () => {
  const base = 'https://github.com/gabielchong/orca-High-Sierra/releases/download/v0.1.1/'
  const r = parseLatestRelease({
    tag_name: 'v0.1.1',
    html_url: 'https://github.com/gabielchong/orca-High-Sierra/releases/tag/v0.1.1',
    assets: [
      { name: 'OrcaHS-0.1.1.zip', browser_download_url: base + 'OrcaHS-0.1.1.zip', size: 10 },
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://evil.example/SHA256SUMS.txt', size: 1 },
      { name: 'OrcaHS-0.1.1.dmg', browser_download_url: base + 'OrcaHS-0.1.1.dmg', size: 11 }
    ]
  })
  assert.deepEqual(r.zip, { name: 'OrcaHS-0.1.1.zip', url: base + 'OrcaHS-0.1.1.zip', size: 10 })
  assert.equal(r.sums, null)
})

test('expectedSha256 reads shasum-style lines', () => {
  const txt = 'a'.repeat(64) + '  OrcaHS-0.1.1.zip\n' + 'b'.repeat(64) + ' *OrcaHS-0.1.1.dmg\n'
  assert.equal(expectedSha256(txt, 'OrcaHS-0.1.1.zip'), 'a'.repeat(64))
  assert.equal(expectedSha256(txt, 'OrcaHS-0.1.1.dmg'), 'b'.repeat(64))
  assert.equal(expectedSha256(txt, 'nope'), null)
})
