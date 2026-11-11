import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextPermissions } from '../src/renderer/src/context-permissions'
import type { Conversation, ProviderId, PublicState } from '../src/shared/contracts'

afterEach(() => vi.unstubAllGlobals())
function render(provider: ProviderId, limit?: number, measured = true) {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const conversation = { id: 'conversation', messages: measured ? [{
    id: 'message', role: 'assistant', text: '', notes: [], createdAt: '2026-01-01T00:00:00Z',
    contextUsage: { provider, model: 'custom', inputTokens: 16000, outputTokens: 0, limit, measuredAt: '2026-01-01T00:00:00Z' },
  }] : [] } as unknown as Conversation
  const state = { providers: [{ id: provider, model: 'custom' }], chatgpt: { active: 'account' } } as unknown as PublicState
  return renderToStaticMarkup(createElement(ContextPermissions, { conversation, state, provider, busy: false }))
}
it.each(['chatgpt', 'openai', 'copilot', 'opencode', 'anthropic', 'google'] as const)('renders the same measured indicator for %s', provider => {
  expect(render(provider, 64000)).toContain('Context: 16k tokens · 25% used')
})
it('shows tokens rather than a meaningless dash when subscription capacity is unknown', () => {
  const html = render('chatgpt')
  expect(html).toContain('Context: 16k tokens')
  expect(html).toContain('data-unknown="true"')
  expect(html).not.toContain('0%')
})
it('does not display missing measurements as zero consumption', () => {
  const html = render('chatgpt', undefined, false)
  expect(html).toContain('Context: — tokens')
  expect(html).not.toContain('0%')
})
