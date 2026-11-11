import { useGitDialog } from './git-dialog'
import { useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, GitBranch, RefreshCw, Check, FileText, Download, Upload, Search } from 'lucide-react'
import type { GitHistory } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { liveRefresh } from './live-refresh'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import { GitFileGroup, GitDiff, useGitDiff } from './git-review'
import './assets/git-panel.css'
import { GitConflict } from './git-conflict'
import { GitRebase } from './git-rebase'
import { GitSections, type Details } from './git-sections'
type Section = 'changes' | 'history' | 'branches' | 'stashes' | 'recovery'
// Reset repository-specific drafts and requests when the conversation changes.
export function GitPanel({ conversationId, active = true }: { conversationId: string; active?: boolean }) {
  return <RepositoryPanel key={conversationId} conversationId={conversationId} active={active} />
}
function RepositoryPanel({ conversationId, active }: { conversationId: string; active: boolean }) {
  const { t } = useUI()
  const { confirm, prompt, dialog } = useGitDialog()
  const [conflictPath, setConflictPath] = useState('')
  const [history, setHistory] = useState<GitHistory>()
  const [details, setDetails] = useState<Details>()
  const [section, setSection] = useState<Section>('changes')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [skip, setSkip] = useState(0)
  const [revision, updateRevision] = useState('')
  const [filePath, setFilePath] = useState<string>()
  const setRevision = (value: string) => { setFilePath(undefined); updateRevision(value) }
  const reviewFile = (value: string, path: string) => { setFilePath(path); updateRevision(value) }
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const actionLock = useRef(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [output, setOutput] = useState('')
  const [query, setQuery] = useState('')
  const [pullStrategy, setPullStrategy] = useState('ff-only')
  const endpoint = `/conversations/${conversationId}`
  const { diff, diffError } = useGitDiff(endpoint, revision, refresh, active && !busy, filePath)
  async function act(body: Record<string, string>) {
    if (actionLock.current || loading) return
    actionLock.current = true
    setBusy(body.action)
    setError('')
    setOutput('')
    try {
      const result = await api<{ output: string }>(`${endpoint}/git/action`, body)
      setOutput(result.output || t('Operation completed.', 'Operación completada.'))
      if (body.action === 'commit') {
        setCommitMessage('')
        setSkip(0)
      }
      if (['switch', 'branch', 'track', 'stash-branch'].includes(body.action)) { setSkip(0); setRevision('') }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      actionLock.current = false
      setBusy('')
      setLoading(true)
      setRefresh((value) => value + 1)
    }
  }
  useEffect(() => {
    if (!active || busy) return
    setLoading(true)
    return liveRefresh(async (signal) => {
      try {
        const [nextHistory, nextDetails] = await Promise.all([
          api<GitHistory>(`${endpoint}/git?skip=${skip}`, undefined, undefined, signal),
          api<Details>(`${endpoint}/git/details`, undefined, undefined, signal),
        ])
        if (signal.aborted || actionLock.current) return
        setHistory(nextHistory)
        setDetails(nextDetails)
        setLoadError('')
      } finally { if (!signal.aborted) setLoading(false) }
    }, (cause) => setLoadError(errorMessage(cause)))
  }, [endpoint, skip, refresh, active, busy])
  const changes = history?.changes || []
  const conflicted = (path: string) => details?.conflicts.includes(path) || false
  const staged = changes.filter(
    (item) => item.status !== '??' && item.status[0] !== ' ' && !conflicted(item.path),
  )
  const unstaged = changes.filter(
    (item) => item.status === '??' || item.status[1] !== ' ' || conflicted(item.path),
  )
  async function stageAll() {
    if (actionLock.current || loading || loadError || !details || !history) return
    const files = unstaged.filter((item) => !conflicted(item.path))
    if (!files.length) return
    actionLock.current = true
    setBusy('stage-all')
    setError('')
    setOutput('')
    let completed = 0
    try {
      for (const file of files) {
        await api(`${endpoint}/git/action`, { action: 'stage', path: file.path })
        completed++
      }
      setOutput(t(`${completed} files staged.`, `${completed} archivos preparados.`))
    } catch (cause) {
      setError(t(
        `Staged ${completed} of ${files.length} files. Stopped: ${errorMessage(cause)}`,
        `Se prepararon ${completed} de ${files.length} archivos. Detenido: ${errorMessage(cause)}`,
      ))
    } finally {
      actionLock.current = false
      setBusy('')
      setLoading(true)
      setRefresh((value) => value + 1)
    }
  }
  async function discardUnstaged(path?: string) {
    if (actionLock.current || loading) return
    actionLock.current = true
    setBusy('discard-preview')
    setError('')
    setOutput('')
    try {
      const result = await api<{ output: string }>(`${endpoint}/git/action`, { action: 'discard-preview', ...(path ? { path } : {}) })
      const preview = JSON.parse(result.output) as { paths: string[]; snapshot: string }
      const message = t(
        `Discard unstaged changes in ${preview.paths.length} file(s)? Staged changes and new files are retained. This cannot be undone through reflog. The file filter does not limit this action.`,
        `¿Descartar los cambios sin preparar de ${preview.paths.length} archivo(s)? Se conservan los cambios preparados y los archivos nuevos. No se puede deshacer mediante reflog. El filtro de archivos no limita esta acción.`,
      )
      if (!await confirm(`${message}\n\n${preview.paths.slice(0, 20).join('\n')}${preview.paths.length > 20 ? '\n…' : ''}`)) return
      const applied = await api<{ output: string }>(`${endpoint}/git/action`, { action: 'discard-unstaged', ...(path ? { path } : {}), snapshot: preview.snapshot })
      setOutput(applied.output)
    } catch (cause) { setError(errorMessage(cause)) }
    finally {
      actionLock.current = false
      setBusy('')
      setLoading(true)
      setRefresh(value => value + 1)
    }
  }
  const locked = !!busy || loading || !!loadError || !details || !history
  const revisionTitle =
    revision === 'working'
      ? t('Unstaged changes', 'Cambios sin preparar')
      : revision === 'staged'
        ? t('Staged changes', 'Cambios preparados')
        : `${t('Commit', 'Commit')} ${revision.slice(0, 7)}`
  const refreshData = () => {
    setError('')
    setRefresh((value) => value + 1)
  }
  if (conflictPath) return <GitConflict key={conflictPath} endpoint={endpoint} path={conflictPath}
    close={() => setConflictPath('')} saved={() => { setConflictPath(''); setRefresh(value => value + 1) }} />
  return (
    <div className="git-panel git-workbench">
      {dialog}
      <header className="git-repository-header">
        <span className="git-repository-icon">
          <GitBranch size={18} />
        </span>
        <div>
          <small>{t('Current branch', 'Rama actual')}</small>
          <strong title={history?.branch}>
            {history?.branch ||
              (loading ? t('Loading…', 'Cargando…') : t('Unavailable', 'No disponible'))}
          </strong>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={!!busy || loading}
          aria-label={t('Refresh Git', 'Actualizar Git')}
          title={t('Refresh Git', 'Actualizar Git')}
          onClick={refreshData}
        >
          <RefreshCw size={16} />
        </Button>
      </header>
      <div className="git-sync-bar">
        <span>
          {history
            ? changes.length
              ? t(`${changes.length} changed files`, `${changes.length} archivos modificados`)
              : t('Working tree clean', 'Árbol de trabajo limpio')
            : t('Repository', 'Repositorio')}
        </span>
        <Button
          variant="ghost"
          size="small"
          disabled={locked}
          title={t(
            'Fetch all remotes without changing your files',
            'Consultar remotos sin modificar tus archivos',
          )}
          onClick={() => void act({ action: 'fetch', prune: 'no' })}
        >
          <RefreshCw size={14} />
          Fetch
        </Button>
        <Button
          variant="ghost"
          size="small"
          disabled={locked}
          title={t('Pull using the selected strategy', 'Actualizar con la estrategia seleccionada')}
          onClick={async () => {
            if (pullStrategy === 'ff-only' || await confirm(t('Integrate upstream changes using the selected strategy? This may create conflicts or rewrite local commits.', '¿Integrar cambios remotos con la estrategia seleccionada? Puede generar conflictos o reescribir commits locales.')))
              void act({ action: 'pull', strategy: pullStrategy })
          }}
        >
          <Download size={14} />
          Pull
        </Button>
        <Button
          variant="ghost"
          size="small"
          disabled={locked}
          title={t('Push commits to the configured remote', 'Enviar commits al remoto configurado')}
          onClick={() => void act({ action: 'push' })}
        >
          <Upload size={14} />
          Push
        </Button>
      </div>
      <div className="git-sync-bar">
        <label>{t('Pull strategy', 'Estrategia de pull')}
          <select className="input" value={pullStrategy} disabled={locked || !!details?.operation}
            onChange={event => setPullStrategy(event.target.value)}>
            <option value="ff-only">Fast-forward only</option>
            <option value="merge">Merge</option>
            <option value="rebase">Rebase</option>
          </select>
        </label>
        <Button variant="ghost" size="small" disabled={locked} onClick={async () => {
          if (await confirm(t('Fetch all remotes and remove stale remote-tracking references? Local branches are retained.', '¿Consultar todos los remotos y eliminar referencias remotas obsoletas? Se conservan las ramas locales.')))
            void act({ action: 'fetch', prune: 'yes' })
        }}>Fetch + prune…</Button>
      </div>
      {details && <div className="git-notice">
        {details.upstream
          ? `${details.upstream} · ↑ ${details.ahead ?? '?'} · ↓ ${details.behind ?? '?'}`
          : t('No upstream configured', 'Sin rama de seguimiento')}
        <small> · {t('Remote state as of last fetch', 'Estado remoto según el último fetch')}</small>
      </div>}
      {details?.operation && <div className="git-notice git-notice-warning" role="status">
        <strong>{t('Operation in progress', 'Operación en curso')}: {details.operation}</strong>
        <Button size="small" disabled={locked || !!details.conflicts.length}
          onClick={() => void act({ action: 'continue', operation: details.operation! })}>
          {t('Continue', 'Continuar')}
        </Button>
        {details.operation !== 'merge' && <Button size="small" variant="secondary" disabled={locked}
          onClick={async () => {
            if (await confirm(t('Skip the current commit? Its changes and conflict-resolution edits will be discarded for this operation.', '¿Saltar el commit actual? Se descartarán sus cambios y las ediciones de resolución de esta operación.')))
              void act({ action: 'skip', operation: details.operation! })
          }}>{t('Skip commit…', 'Saltar commit…')}</Button>}
        <Button size="small" variant="secondary" disabled={locked}
          onClick={async () => {
            if (await confirm(t('Abort this operation? Conflict resolution edits may be lost.', '¿Abortar esta operación? Se pueden perder las ediciones de resolución de conflictos.')))
              void act({ action: 'abort', operation: details.operation! })
          }}>{t('Abort…', 'Abortar…')}</Button>
      </div>}
      <nav className="git-section-nav" aria-label={t('Git views', 'Vistas de Git')}>
        {(['changes', 'history', 'branches', 'stashes', 'recovery'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={section === value}
            onClick={() => {
              setSection(value)
              setRevision('')
            }}
          >
            {value === 'changes' ? (
              <FileText size={15} />
            ) : value === 'history' ? (
              <GitCommitHorizontal size={15} />
            ) : (
              <GitBranch size={15} />
            )}
            {value === 'changes'
              ? t('Changes', 'Cambios')
              : value === 'history'
                ? t('History', 'Historial')
                : value === 'branches' ? t('Branches', 'Ramas') : value === 'stashes' ? 'Stashes' : t('Recovery', 'Recuperación')}
            {value === 'changes' && !!changes.length && (
              <span className="git-count">{changes.length}</span>
            )}
          </button>
        ))}
      </nav>
      {(error || loadError) && (
        <div className="git-notice git-notice-error" role="alert">
          <span>{error || loadError}</span>
          <Button variant="ghost" size="small" disabled={!!busy || loading} onClick={refreshData}>
            {t('Retry', 'Reintentar')}
          </Button>
        </div>
      )}
      {!!busy && (
        <p className="git-notice" role="status">
          {t('Running Git operation…', 'Ejecutando operación Git…')} ({busy})
        </p>
      )}
      {output && (
        <details className="git-operation-result">
          <summary>
            <Check size={14} />
            {t('Operation completed · View output', 'Operación completada · Ver resultado')}
          </summary>
          <pre>{output}</pre>
        </details>
      )}
      {revision && /^[a-f0-9]{40,64}$/.test(revision) && <div className="git-sync-bar">
        {(['cherry-pick', 'revert', 'recover', 'tag'] as const).map(action => <Button key={action} size="small" variant="secondary" disabled={locked || !!details?.operation}
          onClick={async () => {
            if (action === 'recover' || action === 'tag') {
              const name = await prompt(t('New reference name (existing references are never overwritten)', 'Nombre de la nueva referencia (no se sobrescriben referencias existentes)'))
              if (name?.trim()) void act({ action, hash: revision, name: name.trim() })
            } else if (await confirm(t(`${action} ${revision.slice(0, 7)} on the current branch? This creates a commit and may cause conflicts.`, `¿${action} ${revision.slice(0, 7)} en la rama actual? Crea un commit y puede producir conflictos.`))) void act({ action, hash: revision })
          }}>{action === 'recover' ? t('Create branch', 'Crear rama') : action === 'tag' ? t('Create tag', 'Crear tag') : action}</Button>)}
      </div>}
      {revision && /^[a-f0-9]{40,64}$/.test(revision) && <>
        <div className="git-sync-bar">
          {(['soft', 'mixed', 'hard'] as const).map(mode => <Button key={mode} size="small" variant="secondary"
            disabled={locked || !!details?.operation || !!changes.length || !details?.head}
            onClick={async () => {
              const explanation = mode === 'soft'
                ? t('Moves HEAD; keeps index and files.', 'Mueve HEAD; conserva índice y archivos.')
                : mode === 'mixed' ? t('Moves HEAD and resets index; keeps files.', 'Mueve HEAD y restablece el índice; conserva archivos.')
                  : t('Moves HEAD, index and working files to the selected commit.', 'Mueve HEAD, índice y archivos al commit seleccionado.')
              if (await confirm(`${explanation} ${t('Requires a clean tree. A recovery branch preserves the old HEAD. Published history may be rewritten. Proceed?', 'Requiere árbol limpio. Una rama de recuperación conserva el HEAD anterior. Puede reescribir historial publicado. ¿Continuar?')}`))
                void act({ action: 'reset', mode, hash: revision, head: details!.head })
            }}>Reset {mode}…</Button>)}
        </div>
        <GitRebase key={revision} endpoint={endpoint} base={revision}
          locked={locked || !!details?.operation || !!changes.length} act={act} />
      </>}
      {filePath && <div className="git-sync-bar">
        {revision === 'working' && changes.find(item => item.path === filePath)?.status === '??'
          ? <Button size="small" disabled={locked || !!details?.operation} onClick={async () => {
            if (await confirm(t(`Ignore only ${filePath}? This edits .gitignore without staging it.`, `¿Ignorar solo ${filePath}? Modifica .gitignore sin prepararlo.`)))
              void act({ action: 'ignore-file', path: filePath })
          }}>{t('Ignore file…', 'Ignorar archivo…')}</Button>
          : revision === 'working' && <Button size="small" disabled={locked || !!details?.operation || !diff || diff.truncated || !!diffError} onClick={async () => {
            if (diff && await confirm(t(`Discard unstaged changes to ${filePath}? Staged content is retained. Uncommitted edits cannot be recovered through reflog.`, `¿Descartar los cambios sin preparar de ${filePath}? Se conserva lo preparado. Las ediciones descartadas no se recuperan con reflog.`)))
              void act({ action: 'discard', path: filePath, snapshot: diff.text })
          }}>{t('Discard unstaged changes…', 'Descartar cambios sin preparar…')}</Button>}

        <Button size="small" disabled={locked} onClick={() => void act({ action: 'file-history', path: filePath })}>{t('File history', 'Historial del archivo')}</Button>
        <Button size="small" disabled={locked} onClick={() => void act({ action: 'blame', path: filePath })}>Blame (HEAD)</Button>
      </div>}
      {revision ? (
        <GitDiff
          revisionTitle={filePath ? `${revisionTitle} · ${filePath}` : revisionTitle}
          hunkAction={!locked && filePath && diff && !diff.truncated && (revision === 'working' || revision === 'staged') && !details?.operation && !details?.conflicts.length && diff.text.startsWith('diff --git ') && !/^(new file|deleted file|old mode|new mode|rename |copy |Binary files|GIT binary patch)/m.test(diff.text) ? (index, lines) => void act({ action: 'hunk', path: filePath, revision, snapshot: diff.text, index: String(index), ...(lines ? { lines: JSON.stringify(lines) } : {}) }) : undefined}
          diff={diff}
          diffError={diffError}
          setRevision={setRevision}
        />
      ) : (
        <div className="git-workbench-content" aria-busy={loading}>
          {loading && (
            <p className="git-hint" role="status">
              {t('Updating repository…', 'Actualizando repositorio…')}
            </p>
          )}
          {history && section === 'changes' && (
            <>
              {!!details?.conflicts.length && (
                <div className="git-notice git-notice-warning">
                  <strong>
                    {t(
                      'Resolve conflicts before committing',
                      'Resuelve los conflictos antes del commit',
                    )}
                  </strong>
                  <p>
                    {t(
                      'Remove conflict markers in your editor, then mark each file resolved. Review the staged diff before committing.',
                      'Elimina los marcadores en tu editor y marca cada archivo como resuelto. Revisa el diff preparado antes del commit.',
                    )}
                  </p>
                </div>
              )}
              {details?.conflicts.map(path => <Button key={path} variant="secondary" disabled={locked}
                onClick={() => setConflictPath(path)}>{t('Resolve visually', 'Resolver visualmente')} · {path}</Button>)}
              <form
                className="git-commit-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (
                    !locked &&
                    staged.length &&
                    !details?.conflicts.length &&
                    commitMessage.trim()
                  )
                    void act({ action: 'commit', message: commitMessage })
                }}
              >
                <label>
                  {t('Commit message', 'Mensaje del commit')}
                  <textarea
                    className="input"
                    rows={3}
                    value={commitMessage}
                    maxLength={10000}
                    disabled={!!busy}
                    placeholder={t('What changed and why?', '¿Qué cambió y por qué?')}
                    onChange={(event) => setCommitMessage(event.target.value)}
                  />
                </label>
                <div>
                  <span>
                    {t(`${staged.length} staged files`, `${staged.length} archivos preparados`)}
                  </span>
                  <Button size="small" type="button" variant="secondary"
                    disabled={locked || !details?.head || !commitMessage.trim() || !!details?.conflicts.length || (!!details?.operation && details.operation !== 'rebase')}
                    onClick={async () => {
                      if (await confirm(t('Replace the current commit with the staged content and this message? Published hashes change. A recovery branch is created.', '¿Sustituir el commit actual con el contenido preparado y este mensaje? Cambian los hashes publicados. Se crea una rama de recuperación.')))
                        void act({ action: 'amend', head: details!.head, message: commitMessage })
                    }}>Amend…</Button>
                  <Button
                    size="small"
                    type="submit"
                    disabled={
                      locked ||
                      !commitMessage.trim() ||
                      !staged.length ||
                      !!details?.conflicts.length
                    }
                  >
                    <GitCommitHorizontal size={16} />
                    {t('Commit', 'Crear commit')}
                  </Button>
                </div>
              </form>
              {!changes.length ? (
                <div className="git-empty">
                  <span className="git-empty-icon">
                    <Check size={24} />
                  </span>
                  <strong>{t('No local changes', 'Sin cambios locales')}</strong>
                  <p>
                    {t(
                      'Your next changes will appear here. Browse history to review previous work.',
                      'Tus próximos cambios aparecerán aquí. Consulta el historial para revisar el trabajo anterior.',
                    )}
                  </p>
                  <Button variant="secondary" size="small" onClick={() => setSection('history')}>
                    {t('Browse history', 'Ver historial')}
                  </Button>
                </div>
              ) : (
                <>
                  <label className="git-search">
                    <Search size={15} />
                    <input
                      aria-label={t('Filter files', 'Filtrar archivos')}
                      placeholder={t('Filter files…', 'Filtrar archivos…')}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <GitFileGroup
                    reviewFile={reviewFile}
                    items={staged}
                    unstageAll={() => act({ action: 'unstage-all' })}
                    unstageAllBlocked={!!details?.conflicts.length}
                    prepared
                    query={query}
                    conflicted={conflicted}
                    locked={locked}
                    loading={loading}
                    setRevision={setRevision}
                    act={act}
                  />
                  <GitFileGroup
                    reviewFile={reviewFile}
                    items={unstaged}
                    stageAll={stageAll}
                    discard={discardUnstaged}
                    discardBlocked={!!details?.operation || !!details?.conflicts.length}
                    prepared={false}
                    query={query}
                    conflicted={conflicted}
                    locked={locked}
                    loading={loading}
                    setRevision={setRevision}
                    act={act}
                  />
                </>
              )}
            </>
          )}
          <GitSections history={history} details={details} section={section} locked={locked}
            loading={loading} skip={skip} setSkip={setSkip} setRevision={setRevision} act={act} />
        </div>
      )}
    </div>
  )
}
