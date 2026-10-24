import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { api, errorMessage } from './api'
import { localFilePath } from './local-file-path'
import './assets/markdown.css'

function CodeBlock({ children }: { children?: ReactNode }) {
  const content = useRef<HTMLPreElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [status, setStatus] = useState('Copy')
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(content.current?.textContent || '')
      setStatus('Copied')
    } catch { setStatus('Could not copy') }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('Copy'), 2500)
  }
  const [language, setLanguage] = useState('text')
  useEffect(() => {
    const name = content.current?.querySelector('code')?.className.match(/language-([^\s]+)/)?.[1]
    setLanguage(name || 'text')
  }, [children])
  return <section className="code-editor" aria-label="Code block">
    <header className="code-editor-toolbar"><span>{language}</span><button type="button" onClick={() => void copy()} aria-label="Copy code"><span aria-live="polite">{status}</span></button></header>
    <pre ref={content} tabIndex={0} aria-label="Code, horizontal scrolling">{children}</pre>
  </section>
}

function FileLink({ href, children, conversationId }: { href?: string; children?: ReactNode; conversationId?: string }) {
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const lock = useRef(false)
  const path = localFilePath(href || '')
  if (!path) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  if (!conversationId) return <span title={path}>{children}</span>
  async function reveal() {
    if (lock.current) return
    lock.current = true
    setOpening(true)
    setError('')
    try { await api(`/conversations/${conversationId}/files/reveal`, { path }) }
    catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setOpening(false) }
  }
  return <><button type="button" title={`Show in file explorer on the server: ${path}`} disabled={opening} onClick={() => void reveal()} style={{ display: 'inline', padding: 0, minHeight: 0, border: 0, borderRadius: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer', overflowWrap: 'anywhere' }}>{children}</button>{error && <span role="alert" className="error-text"> {error}</span>}</>
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Table, horizontal scrolling"><table>{children}</table></div>,
  img: ({ alt, src }) => <a href={src} target="_blank" rel="noreferrer">{alt || 'View image'}</a>,
}

export default memo(function MessageMarkdown({ children, conversationId }: { children: string; conversationId?: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
    urlTransform={(url, key, node) => ((node.tagName === 'a' && key === 'href') || (node.tagName === 'img' && key === 'src')) && localFilePath(url) ? url : defaultUrlTransform(url)}
    components={{ ...components,
      a: ({ children, href }) => <FileLink href={href} conversationId={conversationId}>{children}</FileLink>,
      img: ({ alt, src }) => <FileLink href={src} conversationId={conversationId}>{alt || 'View image'}</FileLink>,
    }} skipHtml>{children}</Markdown>
})
