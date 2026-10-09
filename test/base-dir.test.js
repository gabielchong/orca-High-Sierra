const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveBaseDir } = require('../app/base-dir')

const common = { execPath: '/Users/me/Desktop/OrcaHS/OrcaHS.app/Contents/MacOS/OrcaHS', appData: '/Users/me/Library/Application Support', productName: 'OrcaHS' }

test('--base-dir wins', () => {
  const r = resolveBaseDir({ ...common, argBaseDir: '/tmp/x', exists: () => true })
  assert.deepEqual(r, { dir: '/tmp/x', mode: 'flag' })
})

test('portable folder next to the bundle is used when present', () => {
  const r = resolveBaseDir({ ...common, exists: (p) => p === '/Users/me/Desktop/OrcaHS/OrcaHS-data' })
  assert.deepEqual(r, { dir: '/Users/me/Desktop/OrcaHS/OrcaHS-data', mode: 'portable' })
})

test('falls back to application support', () => {
  const r = resolveBaseDir({ ...common, exists: () => false })
  assert.deepEqual(r, { dir: '/Users/me/Library/Application Support/OrcaHS', mode: 'default' })
})

test('ignores portable lookup when not running from a bundle', () => {
  const r = resolveBaseDir({ ...common, execPath: '/usr/local/bin/orcahs', exists: () => true })
  assert.equal(r.mode, 'default')
})
