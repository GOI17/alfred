import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { liveRefresh } from './live-refresh'
import { ArrowLeft, Check, Plus, X } from 'lucide-react'
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
  unstageAll,
  unstageAllBlocked = false,
}: {
  unstageAll?: () => Promise<void>
  unstageAllBlocked?: boolean
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
              <span className="git-file-path" title={item.path}>
                {item.path}
              </span>
              {prepared ? (
                <Check size={15} aria-label={t('Staged', 'Preparado')} />
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
  diff,
  diffError,
  setRevision,
}: {
  revisionTitle: string
  diff?: { text: string; truncated: boolean }
  diffError: string
  setRevision: (revision: string) => void
}) {
  const { t } = useUI()
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
              <pre>
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
                    {line || ' '}
                  </div>
                ))}
              </pre>
            ) : (
              <p className="git-empty">
                {t(
                  'No diff available. Untracked files need to be staged before previewing.',
                  'No hay diff disponible. Prepara los archivos nuevos para ver sus cambios.',
                )}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function useGitDiff(endpoint: string, revision: string, refresh: number, active = true) {
  const [diff, setDiff] = useState<{ text: string; truncated: boolean }>()
  const [diffError, setDiffError] = useState('')
  useEffect(() => {
    if (!revision || !active) return
    setDiff(undefined)
    setDiffError('')
    return liveRefresh(async (signal) => {
      const data = await api<{ text: string; truncated: boolean }>(
        `${endpoint}/diff?revision=${encodeURIComponent(revision)}`, undefined, undefined, signal,
      )
      if (signal.aborted) return
      setDiff((previous) => previous?.text === data.text && previous.truncated === data.truncated ? previous : data)
      setDiffError('')
    }, (cause) => setDiffError(errorMessage(cause)), revision === 'working' || revision === 'staged' ? 3000 : null)
  }, [endpoint, revision, refresh, active])

  return { diff, diffError }
}
