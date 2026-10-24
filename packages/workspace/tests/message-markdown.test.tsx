import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MessageMarkdown from '../src/renderer/src/message-markdown'

const render = (text: string) => renderToStaticMarkup(createElement(MessageMarkdown, { children: text }))

describe('message Markdown', () => {
  it('renders highlighted code with a copy toolbar', () => {
    const html = render('```bash\necho "hola"\n```')
    expect(html).toContain('code-editor-toolbar')
    expect(html).toContain('Copy code')
    expect(html).toContain('language-bash')
    expect(html).toContain('hljs-string')
  })
  it('supports other languages and unknown or incomplete fences', () => {
    expect(render('```json\n{"ok": true}\n```')).toContain('hljs-attr')
    expect(render('```unknown-language\na < b')).toContain('a &lt; b')
    expect(render('```\nplain\n```')).toContain('code-editor')
  })
  it('renders GFM tables, tasks and strikethrough', () => {
    const html = render('| Nombre | Valor |\n| --- | --- |\n| A | 1 |\n\n- [x] Hecho\n\n~~Antes~~')
    expect(html).toContain('markdown-table-scroll')
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('<del>Antes</del>')
  })
  it('keeps inline code separate from editor blocks', () => {
    const html = render('Usa `pnpm dev` y **negritas**.\n\n> Una cita')
    expect(html).toContain('<code>pnpm dev</code>')
    expect(html).toContain('<strong>negritas</strong>')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('code-editor')
  })
  it('does not execute HTML, unsafe links or fetch remote images', () => {
    const html = render('<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![imagen](https://example.com/a.png)')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    expect(html).toContain('rel="noreferrer"')
  })
})
