import { describe, expect, it } from 'vitest'
import { parseQuote, quoteHref, quoteMarkdown } from '../src/renderer/src/chat-quotes'

describe('chat quotes', () => {
  const quote = { messageId: 'message-1', block: 2, start: 31, text: 'Texto repetido 🐈\nOtra línea' }
  it('preserves source identity, offsets and Unicode through Markdown links', () => {
    expect(parseQuote(quoteHref(quote))).toEqual(quote)
    expect(quoteMarkdown(quote, 'Ver origen')).toContain(`[Ver origen](${quoteHref(quote)})`)
  })
  it('encodes parentheses so selected text cannot terminate a Markdown link', () => {
    const selected = { ...quote, text: 'Unbalanced ) and (( with !*\'' }
    const href = quoteHref(selected)
    expect(href).not.toMatch(/[()!*']/)
    expect(parseQuote(href)).toEqual(selected)
  })
  it('rejects malformed and unbounded anchors', () => {
    for (const href of ['https://example.com', '#chat-quote=%', '#chat-quote=null', '#chat-quote={}',
      quoteHref({ ...quote, start: -1 }), quoteHref({ ...quote, block: 0.5 }),
      quoteHref({ ...quote, text: ' ' }), quoteHref({ ...quote, text: 'a'.repeat(8001) })]) expect(parseQuote(href)).toBeNull()
  })
  it('quotes text literally rather than injecting links, HTML or formatting', () => {
    const markdown = quoteMarkdown({ ...quote, text: '[evil](https://example.com)\n<script> & **bold**' }, 'Ver origen')
    expect(markdown).toContain('> \\[evil\\]\\(https://example.com\\)\n> &lt;script&gt; &amp; \\*\\*bold\\*\\*')
  })
  it('allows multiple independent quotes in a draft', () => {
    const second = { ...quote, start: 90 }
    const draft = [quoteMarkdown(quote, 'Source'), quoteMarkdown(second, 'Source')].join('\n\n')
    expect(draft).toContain(quoteHref(quote))
    expect(draft).toContain(quoteHref(second))
  })
})
