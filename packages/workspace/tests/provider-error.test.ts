import { describe, expect, it } from 'vitest'
import { providerError } from '../src/server/provider-error.js'

describe('safe provider rejection diagnostics', () => {
  it('reports recognized status, code and parameter without exposing the message', () => {
    const error = Object.assign(new Error('private prompt'), { statusCode: 400,
      responseBody: JSON.stringify({ error: { code: 'unsupported_parameter', param: 'max_output_tokens', message: 'private prompt' } }) })
    expect(providerError(error)).toBe('The provider rejected the request (HTTP 400; unsupported_parameter; parameter: max_output_tokens).')
  })
  it('supports parsed SDK error data', () => {
    const error = Object.assign(new Error('private'), { statusCode: 400,
      data: { error: { code: 'context_length_exceeded', param: 'input' } } })
    expect(providerError(error)).toContain('context_length_exceeded; parameter: input')
  })
  it('does not expose unrecognized metadata or malformed response bodies', () => {
    for (const responseBody of ['private token', JSON.stringify({ error: { code: 'private token', param: 'private prompt', message: 'secret' } })]) {
      expect(providerError(Object.assign(new Error('secret'), { statusCode: 404, responseBody })))
        .toBe('The provider rejected the request (HTTP 404).')
    }
  })
})
