import { CopilotError } from './copilot.js'
import { HarnessError } from './harness-runtime.js'

// Only expose recognized protocol metadata, never raw provider messages/bodies:
// those may echo prompts, credentials, or account information.
function rejectionDetails(error: Error) {
  const codes = new Set(['invalid_request_error', 'unsupported_parameter', 'unsupported_value', 'model_not_found', 'context_length_exceeded', 'invalid_value', 'missing_required_parameter'])
  const parameters = new Set(['model', 'input', 'messages', 'instructions', 'stream', 'store', 'max_output_tokens', 'max_tokens', 'temperature', 'tools', 'tool_choice', 'reasoning', 'reasoning.effort'])
  let body: unknown = 'data' in error ? error.data : undefined
  if (!body && 'responseBody' in error && typeof error.responseBody === 'string') {
    try { body = JSON.parse(error.responseBody) } catch { /* No raw body in user-facing diagnostics. */ }
  }
  if (!body || typeof body !== 'object') return ''
  const detail = 'error' in body ? body.error : body
  if (!detail || typeof detail !== 'object') return ''
  const code = 'code' in detail && typeof detail.code === 'string' && codes.has(detail.code) ? detail.code
    : 'type' in detail && typeof detail.type === 'string' && codes.has(detail.type) ? detail.type : undefined
  const param = 'param' in detail && typeof detail.param === 'string' && parameters.has(detail.param) ? detail.param : undefined
  return [code, param && `parameter: ${param}`].filter(Boolean).join('; ')
}

export function providerError(error: unknown) {
  if (error instanceof CopilotError) return error.message
  if (error instanceof HarnessError) return error.message
  if (error instanceof Error && 'statusCode' in error) {
    if (error.statusCode === 401 || error.statusCode === 403)
      return 'The provider rejected authorization. Check the connection in Settings.'
    if (error.statusCode === 429)
      return 'A provider usage limit was reached. Check your plan or wait before trying again.'
    if (error.statusCode === 400 || error.statusCode === 404) {
      const detail = rejectionDetails(error)
      return `The provider rejected the request (HTTP ${error.statusCode}${detail ? `; ${detail}` : ''}).`
    }
  }
  if (error instanceof Error && error.message.startsWith('The response was incomplete.'))
    return error.message
  return 'Could not complete the provider response. Check the connection, model, and credentials in Settings.'
}
