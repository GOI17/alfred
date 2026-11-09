// Quotes travel as ordinary Markdown, so drafts, queues and stored history retain
// both the quoted context and its source without a separate persistence format.
export const QUOTE_PREFIX = '#chat-quote='
export type ChatQuote = { messageId: string; block: number; start: number; text: string }
export function quoteHref(quote: ChatQuote) {
  // encodeURIComponent leaves parentheses unescaped, which can close a Markdown link.
  return QUOTE_PREFIX + encodeURIComponent(JSON.stringify(quote)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
export function parseQuote(href: string): ChatQuote | null {
  if (!href.startsWith(QUOTE_PREFIX) || href.length > 100000) return null
  try {
    const value = JSON.parse(decodeURIComponent(href.slice(QUOTE_PREFIX.length)))
    if (!value || typeof value.messageId !== 'string' || !value.messageId || value.messageId.length > 200 ||
      !Number.isSafeInteger(value.block) || value.block < 0 || !Number.isSafeInteger(value.start) || value.start < 0 ||
      typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) return null
    return { messageId: value.messageId, block: value.block, start: value.start, text: value.text }
  } catch { return null }
}
export function quoteMarkdown(quote: ChatQuote, label: string) {
  // Keep selected Markdown/HTML as literal text, not active links or formatting.
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()!#|~]/g, '\\$&')
  return `> ${escape(quote.text).split(/\r?\n/).join('\n> ')}\n>\n> [${escape(label)}](${quoteHref(quote)})`
}
export function quoteRange(root: HTMLElement, quote: ChatQuote): Range | null {
  // Exact offsets distinguish repeated text. Never highlight a different match.
  if (root.textContent?.slice(quote.start, quote.start + quote.text.length) !== quote.text) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0, started = false
  while (walker.nextNode()) {
    const node = walker.currentNode, length = node.textContent?.length || 0
    if (!started && quote.start < offset + length) {
      range.setStart(node, quote.start - offset); started = true
    }
    const end = quote.start + quote.text.length
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return range }
    offset += length
  }
  return null
}
