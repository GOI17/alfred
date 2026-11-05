import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting, LanguageDescription } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { languages } from '@codemirror/language-data'

// Preserve CodeMirror's token groups and typography, replacing its default
// palette with VS Code Light+/Dark+ colors. CSS handles live theme changes.
const vscodeColors: Record<string, string> = {
  '#708': 'var(--vscode-keyword)',
  '#219': 'var(--vscode-constant)',
  '#164': 'var(--vscode-number)',
  '#a11': 'var(--vscode-string)',
  '#e40': 'var(--vscode-string)',
  '#a50': 'var(--vscode-comment)',
  '#085': 'var(--vscode-type)',
  '#30a': 'var(--vscode-type)',
  '#256': 'var(--vscode-variable)',
  '#00f': 'var(--vscode-function)',
  '#00c': 'var(--vscode-tag)',
  '#940': 'var(--vscode-attribute)',
  '#f00': 'var(--vscode-invalid)',
}
const vscodeHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => ({
  ...spec,
  ...(spec.color ? { color: vscodeColors[spec.color] ?? spec.color } : {}),
})))

export default function FileEditor({ path, content, scroll, saveScroll }: { path: string; content: string; scroll: number; saveScroll: (value: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const language = new Compartment()
    let disposed = false
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: content, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ 'aria-label': path, tabindex: '0' }),
      EditorView.lineWrapping,
      lineNumbers(), search(), keymap.of(searchKeymap), syntaxHighlighting(vscodeHighlightStyle), language.of([]),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--vscode-background)', color: 'var(--vscode-foreground)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' }, '.cm-gutters': { backgroundColor: 'var(--vscode-background)', color: 'var(--vscode-line-number)', border: 'none' } }),
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
