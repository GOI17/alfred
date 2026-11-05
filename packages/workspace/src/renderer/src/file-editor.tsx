import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting, LanguageDescription } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { languages } from '@codemirror/language-data'
export default function FileEditor({ path, content, scroll, saveScroll }: { path: string; content: string; scroll: number; saveScroll: (value: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const language = new Compartment()
    let disposed = false
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ 'aria-label': path, tabindex: '0' }),
      lineNumbers(), search(), keymap.of(searchKeymap), syntaxHighlighting(defaultHighlightStyle), language.of([]),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--background)', color: 'var(--foreground)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' }, '.cm-gutters': { backgroundColor: 'var(--sidebar)', color: 'var(--muted)', border: 'none' } }),
    ] }) })
    view.scrollDOM.scrollTop = scroll
    if (content.length < 300_000 && !content.split('\n').some(line => line.length > 10_000)) {
      const match = LanguageDescription.matchFilename(languages, path)
      void match?.load().then(extension => { if (!disposed) view.dispatch({ effects: language.reconfigure(extension) }) }).catch(() => {})
    }
    return () => { disposed = true; saveScroll(view.scrollDOM.scrollTop); view.destroy() }
  }, [path, content])
  return <div className="file-editor" ref={host} />
}
