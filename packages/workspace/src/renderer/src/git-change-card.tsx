import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useGitDiff } from './git-review'
import { useUI } from './ui-preferences'

type Row = { kind: 'add' | 'remove' | 'context' | 'gap' | 'note'; number?: number; text: string }
export function patchRows(patch: string) {
  const rows: Row[] = []
  let before = 0, after = 0, added = 0, removed = 0, inHunk = false
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      const gap = Number(header[2]) - (inHunk ? after : 1)
      if (gap > 0) rows.push({ kind: 'gap', number: gap, text: '' })
      before = Number(header[1]); after = Number(header[2]); inHunk = true
    } else if (inHunk && line.startsWith('+')) {
      rows.push({ kind: 'add', number: after++, text: line.slice(1) }); added++
    } else if (inHunk && line.startsWith('-')) {
      rows.push({ kind: 'remove', number: before++, text: line.slice(1) }); removed++
    } else if (inHunk && line.startsWith(' ')) {
      rows.push({ kind: 'context', number: after++, text: line.slice(1) }); before++
    } else if (line && !/^(diff --git |index |--- |\+\+\+ )/.test(line)) rows.push({ kind: 'note', text: line })
  }
  return { rows, added, removed }
}
function code(text: string) {
  return text.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:class|function|import|export|const|let|return|if|else|async|await|new|from|public|private|def|true|false|null)\b)/g).map((part, i) => i % 2 ? <span key={i} className={/^['"]/.test(part) ? 'patch-string' : 'patch-keyword'}>{part}</span> : part)
}
export function ChangeCard({ path, revision, endpoint, active, refresh }: { path: string; revision: string; endpoint: string; active: boolean; refresh: number }) {
  const { t } = useUI()
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(true)
  const [full, setFull] = useState(false)
  const [limit, setLimit] = useState(300)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const { diff, diffError } = useGitDiff(endpoint, revision, refresh, active && visible && open, path, full)
  const { rows, added, removed } = useMemo(() => patchRows(diff?.text || ''), [diff?.text])
  return <article ref={ref} className="git-change-card">
    <button className="patch-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      <strong title={path}>{path}</strong>{diff && !diffError && <><b className="git-added">+{added}</b><b className="git-removed">−{removed}</b></>}<ChevronDown size={15} />
    </button>
    {open && (diffError ? <p role="alert">{diffError}</p> : !diff ? <p>{t('Loading diff…', 'Cargando diff…')}</p> : <>
      <div className="patch-scroll" tabIndex={0} aria-label={path}><div className="patch-lines">
        {rows.slice(0, limit).map((row, i) => row.kind === 'gap' ? <button className="patch-gap" key={i} onClick={() => setFull(true)}>↕ {t(`${row.number} unchanged lines`, `${row.number} líneas sin cambios`)}</button> :
          <div className="patch-line" data-kind={row.kind} key={i}><span>{row.number}</span><i>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</i><code>{code(row.text)}</code></div>)}
      </div></div>
      {rows.length > limit && <button className="patch-gap" onClick={() => setLimit(limit + 300)}>{t('Show more lines', 'Mostrar más líneas')}</button>}
      {diff.truncated && <p>{t('Partial diff (2 MB limit)', 'Diff parcial (límite de 2 MB)')}</p>}
      {(added + removed > 0) && <button className="patch-gap" onClick={() => { setFull(!full); setLimit(300) }}>{full ? t('Fold context', 'Contraer contexto') : t('Show full context', 'Mostrar todo el contexto')}</button>}
    </>)}
  </article>
}
