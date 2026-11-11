import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { liveRefresh } from './live-refresh'
import { ArrowLeft, Plus, X } from 'lucide-react'
import type { GitHistory } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

export function GitFileGroup({
  items,
  prepared,
  query,
  conflicted,
  locked,
  loading,
  setRevision,
  act,
  stageAll,
  discard,
  discardBlocked = false,
  unstageAll,
  unstageAllBlocked = false,
  reviewFile,
}: {
  reviewFile: (revision: string, path: string) => void
  unstageAll?: () => Promise<void>
  unstageAllBlocked?: boolean
  discard?: (path?: string) => Promise<void>
  discardBlocked?: boolean
  stageAll?: () => Promise<void>
  items: GitHistory['changes']
  prepared: boolean
  query: string
  conflicted: (path: string) => boolean
  locked: boolean
  loading: boolean
  setRevision: (revision: string) => void
  act: (body: Record<string, string>) => Promise<void>
}) {
  const { t } = useUI()
  const visible = items.filter((item) => item.path.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="git-file-group">
      <div className="git-section-heading">
        <h3>
          {prepared ? t('Staged', 'Preparados') : t('Changes', 'Sin preparar')}{' '}
          <span className="git-count">{items.length}</span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <Button
          variant="ghost"
          size="small"
          disabled={!items.length || loading}
          onClick={() => setRevision(prepared ? 'staged' : 'working')}
        >
          {t('Review diff', 'Revisar diff')}
        </Button>
          {prepared && unstageAll && (
            <Button
              variant="ghost"
              size="small"
              disabled={locked || unstageAllBlocked || !items.length}
              title={t(
                'Unstage all files, regardless of filter. Working files are preserved.',
                'Quitar todos del área de preparación, sin importar el filtro. Se conservan los archivos.',
              )}
              onClick={() => void unstageAll()}
            >
              {t('Unstage all', 'Quitar todos de preparación')}
            </Button>
          )}
          {!prepared && discard && <Button variant="ghost" size="small"
            disabled={locked || discardBlocked || !items.some(item => item.status !== '??')}
            onClick={() => void discard()}>
            {t('Discard all unstaged…', 'Descartar todos sin preparar…')}
          </Button>}
          {!prepared && stageAll && (
            <Button
              variant="ghost"
              size="small"
              disabled={locked || !items.some((item) => !conflicted(item.path))}
              title={t(
                'Stage all unstaged files, regardless of filter. Conflicts are excluded.',
                'Preparar todos los archivos sin preparar, sin importar el filtro. Se excluyen conflictos.',
              )}
              onClick={() => void stageAll()}
            >
              {t('Stage all', 'Preparar todos')}
            </Button>
          )}
        </div>
      </div>
      {!items.length ? (
        <p className="git-hint">
          {prepared
            ? t(
                'Stage files below to include them in your commit.',
                'Prepara archivos para incluirlos en el commit.',
              )
            : t('No unstaged changes.', 'No hay cambios sin preparar.')}
        </p>
      ) : !visible.length ? (
        <p className="git-hint">
          {t('No files match your search.', 'No hay archivos que coincidan.')}
        </p>
      ) : (
        <ul className="git-file-list">
          {visible.map((item) => (
            <li key={item.path}>
              <span
                className="git-file-status"
                data-conflict={conflicted(item.path)}
                title={conflicted(item.path) ? t('Conflict', 'Conflicto') : item.status}
              >
                {conflicted(item.path)
                  ? '!'
                  : prepared
                    ? item.status[0]
                    : item.status === '??'
                      ? '?'
                      : item.status[1]}
              </span>
              <button type="button" className="git-file-path" title={item.path}
                disabled={loading} onClick={() => reviewFile(prepared ? 'staged' : 'working', item.path)}
                aria-label={`${t('Review diff', 'Revisar diff')}: ${item.path}`}>
                {item.path}
              </button>
              {!prepared && discard && item.status !== '??' && <Button variant="ghost" size="small"
                disabled={locked || discardBlocked || conflicted(item.path)}
                aria-label={`${t('Discard unstaged changes', 'Descartar cambios sin preparar')}: ${item.path}`}
                onClick={() => void discard(item.path)}>
                {t('Discard…', 'Descartar…')}
              </Button>}
              {prepared ? (
                <Button variant="ghost" size="small" disabled={locked || unstageAllBlocked}
                  aria-label={`${t('Unstage', 'Quitar de preparación')}: ${item.path}`}
                  onClick={() => void act({ action: 'unstage', path: item.path })}>
                  {t('Unstage', 'Quitar de preparación')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={locked}
                  aria-label={`${conflicted(item.path) ? t('Mark resolved', 'Marcar resuelto') : t('Stage', 'Preparar')}: ${item.path}`}
                  onClick={() =>
                    void act({
                      action: conflicted(item.path) ? 'resolve' : 'stage',
                      path: item.path,
                    })
                  }
                >
                  <Plus size={14} />
                  {conflicted(item.path) ? t('Resolve', 'Resolver') : t('Stage', 'Preparar')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function GitDiff({
  revisionTitle,
  hunkAction,
  diff,
  diffError,
  setRevision,
}: {
  revisionTitle: string
  hunkAction?: (index: number, lines?: number[]) => void
  diff?: { text: string; truncated: boolean }
  diffError: string
  setRevision: (revision: string) => void
}) {
  const { t } = useUI()
  const [selected, setSelected] = useState<number[]>([])
  const [split, setSplit] = useState(false)
  useEffect(() => setSelected([]), [diff?.text, revisionTitle])
  return (
    <>
      <div className="git-diff-heading">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Back to list', 'Volver a la lista')}
          onClick={() => setRevision('')}
        >
          <ArrowLeft size={16} />
        </Button>
        <strong>{revisionTitle}</strong>
        <Button variant="ghost" size="small" aria-pressed={split} onClick={() => setSplit(value => !value)}>
          {split ? t('Unified view', 'Vista unificada') : t('Side by side', 'Lado a lado')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Close diff', 'Cerrar diff')}
          onClick={() => setRevision('')}
        >
          <X size={15} />
        </Button>
      </div>
      <div className="diff-view" tabIndex={0} aria-label={revisionTitle}>
        {diffError ? (
          <p className="git-notice git-notice-error" role="alert">
            {diffError}
          </p>
        ) : !diff ? (
          <p className="git-empty" role="status">
            {t('Loading changes…', 'Cargando cambios…')}
          </p>
        ) : (
          <>
            {diff.truncated && (
              <p className="git-notice">
                {t(
                  'Preview limited to 2 MB. Review the remaining changes in Git.',
                  'Vista limitada a 2 MB. Revisa el resto de los cambios en Git.',
                )}
              </p>
            )}
            {diff.text ? (
              <pre style={split ? { minWidth: 640 } : undefined}>
                {split && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}><strong>{t('Before', 'Antes')}</strong><strong>{t('After', 'Después')}</strong></div>}
                {diff.text.split('\n').map((line, index) => (
                  <div
                    key={index}
                    data-kind={
                      line.startsWith('+++') ||
                      line.startsWith('---') ||
                      line.startsWith('diff --git')
                        ? 'file'
                        : line.startsWith('+')
                          ? 'add'
                          : line.startsWith('-')
                            ? 'remove'
                            : line.startsWith('@@')
                              ? 'section'
                              : 'context'
                    }
                  >
                    {hunkAction && /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line) && <input type="checkbox" aria-label={`${t('Select changed line', 'Seleccionar línea modificada')} ${index + 1}`} checked={selected.includes(index)} onChange={event => setSelected(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} />}
                    {split && !/^(diff |index |---|\+\+\+|@@|\\)/.test(line) ? (
                      <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderRight: '1px solid currentColor', paddingRight: 8 }}>{line.startsWith('+') ? ' ' : line.slice(1) || ' '}</span>
                        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', paddingLeft: 8 }}>{line.startsWith('-') ? ' ' : line.slice(1) || ' '}</span>
                      </span>
                    ) : line || ' '}
                    {hunkAction && line.startsWith('@@ ') && <Button size="small" variant="secondary" onClick={() => hunkAction(diff.text.split('\n').slice(0, index).filter(value => value.startsWith('@@ ')).length)}>{t('Apply this hunk to index', 'Aplicar este bloque al índice')}</Button>}
                    {hunkAction && line.startsWith('@@ ') && (() => {
                      const lines = diff.text.split('\n')
                      const next = lines.findIndex((value, offset) => offset > index && value.startsWith('@@ '))
                      const chosen = selected.filter(offset => offset > index && (next < 0 || offset < next))
                      return chosen.length > 0 && <Button size="small" variant="secondary" onClick={() => hunkAction(lines.slice(0, index).filter(value => value.startsWith('@@ ')).length, chosen)}>{t('Apply selected lines to index', 'Aplicar líneas seleccionadas al índice')}</Button>
                    })()}
                  </div>
                ))}
              </pre>
            ) : (
              <p className="git-empty">
                {t(
                  'No changes in this view. Select a new file individually to preview its contents.',
                  'No hay cambios en esta vista. Selecciona un archivo nuevo individualmente para ver su contenido.',
                )}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function useGitDiff(endpoint: string, revision: string, refresh: number, active = true, filePath?: string) {
  const [diff, setDiff] = useState<{ text: string; truncated: boolean }>()
  const [diffError, setDiffError] = useState('')
  useEffect(() => {
    if (!revision || !active) return
    setDiff(undefined)
    setDiffError('')
    return liveRefresh(async (signal) => {
      const data = await api<{ text: string; truncated: boolean }>(
        `${endpoint}/diff?revision=${encodeURIComponent(revision)}${filePath !== undefined ? `&path=${encodeURIComponent(filePath)}` : ''}`, undefined, undefined, signal,
      )
      if (signal.aborted) return
      setDiff((previous) => previous?.text === data.text && previous.truncated === data.truncated ? previous : data)
      setDiffError('')
    }, (cause) => setDiffError(errorMessage(cause)), revision === 'working' || revision === 'staged' ? 3000 : null)
  }, [endpoint, revision, refresh, active, filePath])

  return { diff, diffError }
}
