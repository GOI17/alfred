import { useGitDialog } from './git-dialog'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, GitBranch, GitMerge, Plus } from 'lucide-react'
import { graphRows } from '../../shared/git-graph'
import type { GitHistory } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

export type Details = {
  head: string
  remoteBranches: string[]
  stashes: { hash: string; ref: string; subject: string }[]
  reflog: { hash: string; ref: string; subject: string }[]
  branches: string[]; localBranches: string[]; conflicts: string[]; remotes: string[]
  upstream: string | null; ahead: number | null; behind: number | null
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
}

type Props = {
  history: GitHistory | undefined
  details: Details | undefined
  section: string
  locked: boolean
  loading: boolean
  skip: number
  setSkip: (update: (value: number) => number) => void
  setRevision: (value: string) => void
  act: (body: Record<string, string>) => Promise<void>
}
export function GitSections({ history, details, section, locked, loading, skip, setSkip, setRevision, act }: Props) {
  const { t, language } = useUI()
  const { confirm, prompt, dialog } = useGitDialog()
  const [remote, setRemote] = useState('')
  const [file, setFile] = useState('')
  const [search, setSearch] = useState('')
  const [compareFrom, setCompareFrom] = useState('')
  const [compareTo, setCompareTo] = useState('HEAD')
  const [branchName, setBranchName] = useState('')
  const [mergeBranch, setMergeBranch] = useState('')
  const changes = history?.changes || []
  const graph = graphRows(history?.commits ?? [])
  const graphWidth = Math.max(1, ...graph.map(row => row.width)) * 16 + 8
  return <>
          {dialog}
          {history && section === 'history' && (
            <>
              <div className="git-section-heading">
                <h3>{t('Commit history', 'Historial de commits')}</h3>
                <span className="git-hint">{t('All branches · ', 'Todas las ramas · ')}{history.branch}</span>
              </div>
              <label>{t('Search this page (message, author, hash, refs)', 'Buscar en esta página (mensaje, autor, hash, referencias)')}
                <input className="input" value={search} onChange={event => setSearch(event.target.value)} />
              </label>
              <div className="git-sync-bar">
                <label>{t('Repository-relative file path', 'Ruta de archivo relativa al repositorio')}
                  <input className="input" value={file} onChange={event => setFile(event.target.value)} />
                </label>
                <Button disabled={locked || !file.trim()} onClick={() => void act({ action: 'file-history', path: file })}>{t('File history', 'Historial del archivo')}</Button>
                <Button disabled={locked || !file.trim()} onClick={() => void act({ action: 'blame', path: file })}>Blame (HEAD)</Button>
              </div>
              <div className="commit-list">
                {history.commits.map((commit, index) => (
                  <button
                    key={commit.hash}
                    hidden={!`${commit.subject} ${commit.author} ${commit.hash} ${commit.refs}`.toLowerCase().includes(search.toLowerCase())}
                    className="commit"
                    onClick={() => setRevision(commit.hash)}
                  >
                    <svg className="git-graph-row" width={graphWidth} height="56" viewBox={`0 0 ${graphWidth} 56`} aria-hidden="true">
                      {graph[index].edges.map((edge, edgeIndex) => <path key={edgeIndex}
                        d={`M ${edge.from * 16 + 12} 0 L ${edge.from * 16 + 12} 28 L ${edge.to * 16 + 12} 56`}
                        fill="none" stroke="currentColor" strokeWidth="1.5" />)}
                      <circle cx={graph[index].column * 16 + 12} cy="28" r="4" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <span>
                      <strong>{commit.subject}</strong>
                      {commit.refs && <span className="commit-meta">{commit.refs}</span>}
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
          {section === 'stashes' && <section className="git-branch-card">
            <h3>Stashes</h3>
            <p className="git-hint">{t('Apply retains the stash. Pop removes it only after a successful apply. Conflicts keep the original stash.', 'Aplicar conserva el stash. Pop lo elimina solo tras aplicarlo correctamente. Los conflictos conservan el stash original.')}</p>
            <Button size="small" disabled={locked || !!details?.operation || !changes.length} onClick={async () => {
              const message = await prompt(t('Stash description', 'Descripción del stash'))
              if (!message?.trim()) return
              const includeUntracked = await confirm(t('Include untracked files?', '¿Incluir archivos nuevos?'), t('Tracked files only', 'Solo archivos seguidos'))
              if (includeUntracked === null) return
              const untracked = includeUntracked ? 'yes' : 'no'
              void act({ action: 'stash-create', message, untracked })
            }}>{t('Save stash…', 'Guardar stash…')}</Button>
            {!details?.stashes.length && <p>{t('No stashes.', 'No hay stashes.')}</p>}
            {details?.stashes.map(stash => <div className="git-branch-card" key={stash.ref}>
              <strong>{stash.ref} · {stash.subject}</strong>
              <Button size="small" disabled={locked || !!details.operation || !!changes.length} onClick={async () => {
                const name = await prompt(t('Create and switch to a branch from this stash? Stash is retained. Branch name:', '¿Crear una rama desde este stash y cambiar a ella? Se conserva el stash. Nombre:'))
                if (name?.trim()) void act({ action: 'stash-branch', hash: stash.hash, name: name.trim() })
              }}>{t('Create branch…', 'Crear rama…')}</Button>
              <div className="git-sync-bar">{(['stash-show', 'stash-apply', 'stash-pop', 'stash-drop'] as const).map(action => <Button size="small" variant="secondary" key={action} disabled={locked || (action !== 'stash-show' && !!details.operation)} onClick={async () => {
                if (action === 'stash-show' || await confirm(t(`${action}: ${stash.ref}? Drop permanently removes this stash reference. Apply/pop require a clean working tree.`, `${action}: ¿${stash.ref}? Drop elimina esta referencia. Aplicar/pop requieren un árbol limpio.`))) void act({ action, hash: stash.hash })
              }}>{action === 'stash-show' ? t('Inspect', 'Inspeccionar') : action === 'stash-apply' ? t('Apply', 'Aplicar') : action === 'stash-pop' ? 'Pop' : t('Delete…', 'Eliminar…')}</Button>)}</div>
            </div>)}
          </section>}
          {section === 'recovery' && <section className="git-branch-card">
            <h3>Reflog</h3>
            <p className="git-hint">{t('Last 50 local reference updates. Inspect a commit and create a recovery branch without moving HEAD.', 'Últimos 50 movimientos locales. Inspecciona un commit y crea una rama de recuperación sin mover HEAD.')}</p>
            {details?.reflog.map((entry, index) => <Button key={`${entry.ref}-${index}`} variant="ghost" disabled={locked} onClick={() => setRevision(entry.hash)}>{entry.ref} · {entry.subject}</Button>)}
          </section>}
          {history && section === 'branches' && (
            <>
              <section className="git-branch-card">
                <h3>{t('Local branches', 'Ramas locales')}</h3>
                {details?.localBranches.map(branch => <div key={branch} className="git-section-heading">
                  <span>{branch}{branch === history.branch ? ' ✓' : ''}</span>
                  <Button size="small" variant="ghost" disabled={locked || !!details.operation} onClick={async () => {
                    const name = await prompt(t('New branch name', 'Nuevo nombre de rama'), branch)
                    if (name?.trim() && name !== branch) void act({ action: 'branch-rename', branch, name: name.trim() })
                  }}>{t('Rename', 'Renombrar')}</Button>
                  <Button size="small" variant="ghost" disabled={locked || !!details.operation || branch === history.branch} onClick={async () => {
                    if (await confirm(t(`Delete local branch ${branch}? Git will reject unmerged or occupied branches.`, `¿Eliminar la rama local ${branch}? Git rechazará ramas sin integrar u ocupadas.`))) void act({ action: 'branch-delete', branch })
                  }}>{t('Delete…', 'Eliminar…')}</Button>
                  <Button size="small" variant="secondary"
                    disabled={locked || !!details.operation || branch === history.branch}
                    onClick={() => void act({ action: 'switch', branch })}>
                    {t('Switch', 'Cambiar')}
                  </Button>
                </div>)}
                <p className="git-hint">{t('Git refuses switches that would overwrite local edits or use a branch occupied by another worktree.', 'Git rechaza cambios que sobrescriban ediciones locales o usen una rama ocupada por otro worktree.')}</p>
              </section>
              <section className="git-branch-card">
                <h3>{t('Remote branches', 'Ramas remotas')}</h3>
                {details?.remoteBranches.filter(ref => !ref.endsWith('/HEAD')).map(ref => <div className="git-sync-bar" key={ref}>
                  <span>{ref.replace(/^refs\/remotes\//, '')}</span>
                  <Button size="small" disabled={locked || !!details.operation || !!changes.length} onClick={async () => {
                    const name = await prompt(t('New local tracking branch name', 'Nombre de la nueva rama local con seguimiento'))
                    if (name?.trim()) void act({ action: 'track', ref, name: name.trim() })
                  }}>{t('Track locally…', 'Seguir localmente…')}</Button>
                </div>)}
                <h3>{t('Publish current branch', 'Publicar rama actual')}</h3>
                <label>{t('Remote', 'Remoto')}
                  <select className="input" value={remote} onChange={event => setRemote(event.target.value)}>
                    <option value="">{t('Select remote', 'Selecciona un remoto')}</option>
                    {details?.remotes.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <Button size="small" disabled={locked || !remote || !!details?.operation || history.branch === 'Detached HEAD'}
                  onClick={async () => {
                    if (await confirm(t(`Publish ${history.branch} to ${remote} and set its upstream?`, `¿Publicar ${history.branch} en ${remote} y configurar su seguimiento?`)))
                      void act({ action: 'publish', remote })
                  }}>{t('Publish…', 'Publicar…')}</Button>
              </section>
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
                <h3>{t('Compare references', 'Comparar referencias')}</h3>
                <label>{t('From reference', 'Referencia origen')}<input className="input" value={compareFrom} onChange={event => setCompareFrom(event.target.value)} /></label>
                <label>{t('To reference', 'Referencia destino')}<input className="input" value={compareTo} onChange={event => setCompareTo(event.target.value)} /></label>
                <Button disabled={locked || !compareFrom.trim() || !compareTo.trim()} onClick={() => void act({ action: 'compare', from: compareFrom.trim(), to: compareTo.trim() })}>{t('Compare', 'Comparar')}</Button>
                <p>{t('Shows the changes from the selected reference to HEAD without modifying files.', 'Muestra los cambios desde la referencia elegida hasta HEAD sin modificar archivos.')}</p>
                {details?.branches.filter(branch => branch !== history.branch).map(branch => <Button key={branch} size="small" variant="secondary" disabled={locked} onClick={() => void act({ action: 'compare', from: branch, to: 'HEAD' })}>{branch} → HEAD</Button>)}
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
  </>
}
