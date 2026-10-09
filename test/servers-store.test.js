const test = require('node:test')
const assert = require('node:assert/strict')
const { parse, upsert, remove, serialize, normalizeOrigin } = require('../app/servers-store')

test('normalizeOrigin keeps only http(s) origins', () => {
  assert.equal(normalizeOrigin('http://192.0.2.10:6768/#code=x'), 'http://192.0.2.10:6768')
  assert.equal(normalizeOrigin('wss://a.example'), null)
  assert.equal(normalizeOrigin('nope'), null)
})

test('upsert moves the server to the top and keeps its label', () => {
  let list = upsert([], 'http://a.example:6768/', 1)
  list = upsert(list, 'http://b.example:6768/', 2)
  assert.deepEqual(list.map((s) => s.origin), ['http://b.example:6768', 'http://a.example:6768'])
  list[1].label = 'Home Mac'
  list = upsert(list, 'http://a.example:6768/#code=abc', 3)
  assert.equal(list[0].origin, 'http://a.example:6768')
  assert.equal(list[0].label, 'Home Mac')
  assert.equal(list.length, 2)
})

test('remove drops by origin', () => {
  const list = upsert(upsert([], 'http://a.example:6768', 1), 'http://b.example:6768', 2)
  assert.deepEqual(remove(list, 'http://a.example:6768/').map((s) => s.origin), ['http://b.example:6768'])
})

test('serialize/parse round-trips and tolerates junk', () => {
  const list = upsert([], 'http://a.example:6768', 5)
  assert.deepEqual(parse(serialize(list)), list)
  assert.deepEqual(parse('not json'), [])
  assert.deepEqual(parse('{"servers":[{"origin":"ftp://x"},{"origin":"http://ok.example"}]}').map((s) => s.origin), ['http://ok.example'])
})
