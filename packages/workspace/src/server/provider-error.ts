import { CopilotError } from './copilot.js'
import { HarnessError } from './harness-runtime.js'

export function providerError(error: unknown) {
  if (error instanceof CopilotError) return error.message
  if (error instanceof HarnessError) return error.message
  if (error instanceof Error && 'statusCode' in error) {
    if (error.statusCode === 401 || error.statusCode === 403)
      return 'The provider rejected authorization. Check the connection in Settings.'
    if (error.statusCode === 429)
      return 'A provider usage limit was reached. Check your plan or wait before trying again.'
    if (error.statusCode === 400 || error.statusCode === 404)
      return 'The provider rejected the request. Check the selected model and your account permissions.'
  }
  if (error instanceof Error && error.message.startsWith('The response was incomplete.'))
    return error.message
  return 'Could not complete the provider response. Check the connection, model, and credentials in Settings.'
}
