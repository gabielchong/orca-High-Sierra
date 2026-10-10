const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The shim lives in preload.js (sandboxed preloads cannot require local files), between markers.
const preload = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
const source = preload.split('// url-shim:start')[1].split('// url-shim:end')[0]
const install = new Function('global', `${source}\nreturn installOrcaHsUrlShim(global)`)

const RealURL = globalThis.URL
const SPECIAL = /^(?:https?|wss?|ftp|file):$/

// Chromium 116 behaviour: for non-special schemes the authority is folded into the path.
class Chromium116URL {
  constructor(input, base) {
    const u = new RealURL(input, base)
    const folded = !SPECIAL.test(u.protocol) && u.host !== ''
    this.href = u.href
    this.protocol = u.protocol
    this.origin = u.origin
    this.host = folded ? '' : u.host
    this.hostname = folded ? '' : u.hostname
    this.port = folded ? '' : u.port
    this.pathname = folded ? `//${u.host}${u.pathname}` : u.pathname
    this.search = u.search
    this.hash = u.hash
    this.searchParams = u.searchParams
    this.username = u.username
    this.password = u.password
  }
  toString() { return this.href }
}
Chromium116URL.createObjectURL = function () { return 'blob:fake' }

test('url shim stays out of the way on a spec-compliant engine', () => {
  const g = { URL: RealURL }
  assert.equal(install(g), false)
  assert.equal(g.URL, RealURL)
})

test('url shim fixes orca://pair parsing on a Chromium 116-style engine', () => {
  const g = { URL: Chromium116URL }
  assert.equal(install(g), true)
  const u = new g.URL('orca://pair?code=abc-_123')
  assert.equal(u.protocol, 'orca:')
  assert.equal(u.hostname, 'pair')
  assert.equal(u.host, 'pair')
  assert.equal(u.pathname, '')
  assert.equal(u.search, '?code=abc-_123')
  assert.equal(u.searchParams.get('code'), 'abc-_123')
  assert.equal(u.hash, '')
  assert.equal(u.href, 'orca://pair?code=abc-_123')
  assert.equal(String(u), 'orca://pair?code=abc-_123')
  assert.equal(JSON.stringify({ u }), '{"u":"orca://pair?code=abc-_123"}')
  assert.ok(u instanceof g.URL)
  assert.ok(u instanceof Chromium116URL)
})

test('url shim keeps an explicit path, a port and a fragment code', () => {
  const g = { URL: Chromium116URL }
  install(g)
  const withPath = new g.URL('orca://pair/?code=x')
  assert.equal(withPath.pathname, '/')
  assert.equal(withPath.href, 'orca://pair/?code=x')
  const withPort = new g.URL('ws-like://host.example:6768/a/b?q=1#frag')
  assert.equal(withPort.hostname, 'host.example')
  assert.equal(withPort.port, '6768')
  assert.equal(withPort.pathname, '/a/b')
  assert.equal(withPort.hash, '#frag')
  const fragmentCode = new g.URL('orca://pair#abc')
  assert.equal(fragmentCode.hostname, 'pair')
  assert.equal(fragmentCode.hash, '#abc')
})

test('url shim leaves special schemes and authority-less URLs untouched', () => {
  const g = { URL: Chromium116URL }
  install(g)
  const http = new g.URL('http://192.168.1.11:6768/#code=abc')
  assert.equal(http.hostname, '192.168.1.11')
  assert.equal(http.hash, '#code=abc')
  const noAuthority = new g.URL('orca:foo')
  assert.equal(noAuthority.hostname, '')
  assert.equal(noAuthority.pathname, 'foo')
  assert.equal(g.URL.createObjectURL({}), 'blob:fake')
})
