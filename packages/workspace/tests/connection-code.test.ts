import { expect, it } from 'vitest'
import { readConnectionCode } from '../src/renderer/src/connection-code'

const origin = 'https://alfred.example'
it('extracts a QR credential locally and keeps manual server codes working', () => {
  expect(readConnectionCode(`${origin}/#connectionCode=temporary%2Bcode`, origin, true)).toEqual({ code: 'temporary+code' })
  expect(readConnectionCode(`  ${origin}/#connectionCode=temporary-code  `, origin)).toEqual({ code: 'temporary-code' })
  expect(readConnectionCode(' manual-code ', origin)).toEqual({ code: 'manual-code' })
})
it.each([
  'https://other.example/#connectionCode=secret',
  'https://alfred.example.attacker.test/#connectionCode=secret',
  'http://alfred.example/#connectionCode=secret',
  'https://alfred.example:444/#connectionCode=secret',
])('rejects a different server without exposing its credential: %s', (link) => {
  expect(readConnectionCode(link, origin, true)).toEqual({ error: 'different-server' })
})
it.each([
  'plain text', 'javascript:alert(1)', '//alfred.example/#connectionCode=secret',
  `${origin}/?connectionCode=secret`, `${origin}/#connectionCode=`,
  `${origin}/#connectionCode=one&connectionCode=two`,
  `${origin}/#connectionCode=${'x'.repeat(201)}`,
  'https://user:password@alfred.example/#connectionCode=secret',
])('rejects invalid scanned links: %s', (link) => {
  expect(readConnectionCode(link, origin, true)).toEqual({ error: 'invalid' })
})
it('bounds pasted codes and links before authentication', () => {
  expect(readConnectionCode('  ', origin)).toEqual({ error: 'invalid' })
  expect(readConnectionCode('x'.repeat(201), origin)).toEqual({ error: 'invalid' })
  expect(readConnectionCode('javascript:alert(1)', origin)).toEqual({ error: 'invalid' })
})
