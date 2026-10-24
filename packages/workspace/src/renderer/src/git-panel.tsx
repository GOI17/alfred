import { useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, GitBranch, RefreshCw, ChevronLeft, ChevronRight, Check, Plus, FileText, Download, Upload, GitMerge, Search } from 'lucide-react'
import type { GitHistory } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { liveRefresh } from './live-refresh'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import { GitFileGroup, GitDiff, useGitDiff } from './git-review'
import './assets/git-panel.css'
type Details = { branches: string[]; conflicts: string[] }
type Section = 'changes' | 'history' | 'branches'
// Reset repository-specific drafts and requests when the conversation changes.
export function GitPanel({ conversationId, active = true }: { conversationId: string; active?: boolean }) {
  return <RepositoryPanel key={conversationId} conversationId={conversationId} active={active} />
}
function RepositoryPanel({ conversationId, active }: { conversationId: string; active: boolean }) {
  const { t, language } = useUI()
  const [history, setHistory] = useState<GitHistory>()
  const [details, setDetails] = useState<Details>()
  const [section, setSection] = useState<Section>('changes')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [skip, setSkip] = useState(0)
  const [revision, setRevision] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const actionLock = useRef(false)
  const [branchName, setBranchName] = useState('')
  const [mergeBranch, setMergeBranch] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [output, setOutput] = useState('')
  const [query, setQuery] = useState('')
  const endpoint = `/conversations/${conversationId}`
  const { diff, diffError } = useGitDiff(endpoint, revision, refresh, active && !busy)
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
      if (body.action === 'branch') setBranchName('')
      if (body.action === 'merge') setMergeBranch('')
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
  return (
    <div className="git-panel git-workbench">
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
          onClick={() => void act({ action: 'fetch' })}
        >
          <RefreshCw size={14} />
          Fetch
        </Button>
        <Button
          variant="ghost"
          size="small"
          disabled={locked}
          title={t('Pull with fast-forward only', 'Actualizar solo con avance rápido')}
          onClick={() => void act({ action: 'pull' })}
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
      <nav className="git-section-nav" aria-label={t('Git views', 'Vistas de Git')}>
        {(['changes', 'history', 'branches'] as const).map((value) => (
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
                : t('Branches', 'Ramas')}
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
      {revision ? (
        <GitDiff
          revisionTitle={revisionTitle}
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
                  <strong>{t('All clean', 'Todo al día')}</strong>
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
                    items={unstaged}
                    stageAll={stageAll}
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
          {history && section === 'history' && (
            <>
              <div className="git-section-heading">
                <h3>{t('Commit history', 'Historial de commits')}</h3>
                <span className="git-hint">{history.branch}</span>
              </div>
              <div className="commit-list">
                {history.commits.map((commit) => (
                  <button
                    key={commit.hash}
                    className="commit"
                    onClick={() => setRevision(commit.hash)}
                  >
                    <span className="commit-node">
                      <GitCommitHorizontal size={18} />
                    </span>
                    <span>
                      <strong>{commit.subject}</strong>
                      <span className="commit-meta">
                        {commit.author} · {new Date(commit.date).toLocaleDateString(language)}
                        <code>{commit.shortHash}</code>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {!history.commits.length && (
                <p className="git-empty">
                  {t('No commits on this page.', 'No hay commits en esta página.')}
                </p>
              )}
              <div className="pagination">
                <Button
                  variant="ghost"
                  size="small"
                  disabled={!skip || loading}
                  onClick={() => setSkip((value) => Math.max(0, value - 50))}
                >
                  <ChevronLeft size={14} />
                  {t('Previous', 'Anterior')}
                </Button>
                <span>
                  {history.commits.length ? `${skip + 1}–${skip + history.commits.length}` : '0'}
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={!history.hasMore || loading}
                  onClick={() => setSkip((value) => value + 50)}
                >
                  {t('Next', 'Siguiente')}
                  <ChevronRight size={14} />
                </Button>
              </div>
            </>
          )}
          {history && section === 'branches' && (
            <>
              <section className="git-branch-card">
                <h3>
                  <GitBranch size={16} />
                  {t('Create a branch', 'Crear una rama')}
                </h3>
                <p className="git-hint">
                  {t(
                    'Creates a branch from HEAD and switches to it.',
                    'Crea una rama desde HEAD y cambia a ella.',
                  )}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (branchName.trim()) void act({ action: 'branch', name: branchName })
                  }}
                >
                  <label>
                    {t('Branch name', 'Nombre de la rama')}
                    <input
                      className="input"
                      placeholder="feature/…"
                      maxLength={150}
                      value={branchName}
                      onChange={(event) => setBranchName(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    size="small"
                    type="submit"
                    disabled={locked || !branchName.trim()}
                  >
                    <Plus size={14} />
                    {t('Create and switch', 'Crear y cambiar')}
                  </Button>
                </form>
              </section>
              <section className="git-branch-card">
                <h3>
                  <GitMerge size={16} />
                  {t('Merge into current branch', 'Fusionar en la rama actual')}
                </h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (mergeBranch && !details?.conflicts.length)
                      void act({ action: 'merge', branch: mergeBranch })
                  }}
                >
                  <label>
                    {t('Source branch', 'Rama de origen')}
                    <select
                      className="input"
                      value={mergeBranch}
                      onChange={(event) => setMergeBranch(event.target.value)}
                    >
                      <option value="">{t('Select a branch', 'Selecciona una rama')}</option>
                      {details?.branches
                        .filter((branch) => branch !== history.branch)
                        .map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="git-merge-target">
                    {mergeBranch || '…'} → <strong>{history.branch}</strong>
                  </p>
                  <p className="git-hint">
                    {t(
                      'Updates your working tree without committing. Review changes and resolve any conflicts before creating the merge commit.',
                      'Modifica tu árbol de trabajo sin crear el commit. Revisa los cambios y resuelve los conflictos antes de crear el commit de merge.',
                    )}
                  </p>
                  <Button
                    variant="secondary"
                    size="small"
                    type="submit"
                    disabled={locked || !mergeBranch || !!details?.conflicts.length}
                  >
                    <GitMerge size={14} />
                    {t('Merge without committing', 'Fusionar sin commit')}
                  </Button>
                </form>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
