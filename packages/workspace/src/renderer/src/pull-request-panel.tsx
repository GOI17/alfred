import { useEffect, useState } from 'react'
import { LinkButton } from '@atlaskit/button/new'
import { ExternalLink, Maximize2, Minimize2, Minus } from 'lucide-react'
import type { PublicState } from '../../shared/contracts'
import type { AiReview, ReviewItem, ReviewSection, WorktreePullRequest } from '../../shared/pull-request'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import './assets/file-viewer.css'
import './assets/panel-content.css'

export function useActivePullRequest(projectId: string | undefined, path: string) {
  const url = projectId && path ? `/projects/${projectId}/pull-request?path=${encodeURIComponent(path)}` : ''
  const [result, setResult] = useState<{ url: string; pr: WorktreePullRequest | null }>()
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending || document.hidden) return
      pending = true
      try {
        const { pr } = await api<{ pr: WorktreePullRequest | null }>(url, undefined, undefined, controller.signal)
        if (!controller.signal.aborted) setResult({ url, pr })
      } catch { if (!controller.signal.aborted) setResult(undefined) }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [url])
  return result?.url === url ? result.pr : null
}

export function PullRequestPanel({ pr, projectId, path, close, providers }: { providers: PublicState['providers']; pr: WorktreePullRequest; projectId: string; path: string; close: () => void }) {
  const { t, language } = useUI()
  const [selected, setSelected] = useState('')
  const provider = providers.find(p => p.id === selected) ?? providers[0]
  const [aiBusy, setAiBusy] = useState(false)
  const [report, setReport] = useState<AiReview>()
  const [aiError, setAiError] = useState('')
  const [maximized, setMaximized] = useState(false)
  const endpoint = `/projects/${projectId}/review?${new URLSearchParams({ path, url: pr.url })}`
  const [revision, refresh] = useState(0)
  const [section, setSection] = useState<ReviewSection>('files')
  const [result, setResult] = useState<{ diff?: string; items?: ReviewItem[] }>()
  const files = result?.diff?.trimEnd().split(/(?=^diff --git )/m).filter(Boolean) ?? []
  const [loadError, setLoadError] = useState('')
  const [action, setAction] = useState<'approve' | 'changes' | 'comment'>(pr.provider === 'Azure Repos' ? 'approve' : 'comment')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const withBody = action === 'comment' || pr.provider === 'GitHub'
  useEffect(() => {
    const controller = new AbortController()
    setResult(undefined); setLoadError('')
    api<{ diff?: string; items?: ReviewItem[] }>(`${endpoint}&section=${section}`, undefined, undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setResult(result)
    }).catch(error => { if (!controller.signal.aborted) setLoadError(errorMessage(error)) })
    return () => controller.abort()
  }, [endpoint, section, revision])
  async function reviewWithAi() {
    if (!provider || aiBusy) return
    setAiBusy(true); setAiError(''); setReport(undefined)
    try {
      setReport(await api<AiReview>(`/projects/${projectId}/review/ai?${new URLSearchParams({ path, url: pr.url })}`, { provider: provider.id, language }))
    } catch (error) { setAiError(errorMessage(error)) }
    finally { setAiBusy(false) }
  }
  async function send() {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      await api(endpoint, { action, body: withBody ? body : '' })
      if (withBody) setBody('')
      setMessage(t('Review submitted.', 'Revisión enviada.'))
    } catch (error) { setMessage(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const name = pr.provider === 'GitLab' ? `Merge request !${pr.number}` : `Pull request #${pr.number}`
  return <section className="file-viewer" data-maximized={maximized} aria-label={name}>
    <div className="tool-dock-heading"><span>{name}</span><div className="tool-dock-actions">
      <LinkButton appearance="subtle" spacing="compact" data-alfred-button="small" href={pr.url} target="_blank" rel="noopener noreferrer">
        <span className="alfred-button-content">{t(`Open in ${pr.provider}`, `Abrir en ${pr.provider}`)}<ExternalLink size={14} aria-hidden="true" /></span>
      </LinkButton>
      <Button variant="ghost" size="icon" aria-label={maximized ? t('Restore', 'Restaurar') : t('Maximize', 'Maximizar')} aria-pressed={maximized} onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</Button>
      <Button variant="ghost" size="icon" aria-label={t(`Hide ${name}`, `Ocultar ${name}`)} onClick={close}><Minus size={15} /></Button>
    </div></div>
    <div className="file-viewer-toolbar"><strong>{pr.provider}</strong><span>{pr.title}</span></div>
    <div className="native-review">
      <small>{pr.isDraft ? t('Draft', 'Borrador') : t('Open', 'Abierto')} · {pr.headRefName} → {pr.baseRefName}</small>
      {pr.body && <p>{pr.body}</p>}
      <div className="review-navigation" role="group" aria-label={t('Review sections', 'Secciones de revisión')}>
        {(['files', 'commits', 'checks'] as const).map(key => <Button key={key} variant="ghost" size="small" aria-pressed={key === section} onClick={() => setSection(key)}>
          {key === 'files' ? t('Changed files', 'Archivos cambiados') : key === 'commits' ? 'Commits' : t('Checks', 'Comprobaciones')}
          {key === section && result && ` (${key === 'files' ? files.length : result.items?.length ?? 0})`}
        </Button>)}
        <Button variant="ghost" size="small" onClick={() => refresh(r => r + 1)}>{t('Refresh', 'Actualizar')}</Button>
      </div>
      {loadError ? <p role="alert">{loadError}</p> : !result ? <p role="status">{t('Loading…', 'Cargando…')}</p> : section === 'files' ? files.length ? files.map((file, i) => {
        const lines = file.trimEnd().split('\n')
        return <details key={i}><summary>{lines[0].replace(/^diff --git .*? b\//, '')}</summary><pre>{lines.slice(1).join('\n')}</pre></details>
      }) : <p>{t('No changed files.', 'Sin archivos cambiados.')}</p> : result.items?.length ? <ul className="review-items">{result.items.map((item, i) => <li key={i}><strong>{item.title}</strong><small>{item.detail}</small></li>)}</ul>
        : <p>{section === 'checks' ? t('No checks reported.', 'No se han registrado comprobaciones.') : t('No commits.', 'Sin commits.')}</p>}
      <fieldset disabled={aiBusy}><legend>{t('AI review', 'Revisión con IA')}</legend>
        {provider ? <>
          <label>{t('Review model', 'Modelo de revisión')} <select value={provider.id} onChange={e => setSelected(e.target.value)}>
            {providers.map(p => <option key={p.id} value={p.id}>{p.id} · {p.model}</option>)}
          </select></label>
          <small>{t('Sends the PR diff to this model. Nothing is posted to the PR.', 'Envía el diff del PR a este modelo. No se publica nada en el PR.')}</small>
          <Button onClick={reviewWithAi} disabled={aiBusy}>{aiBusy ? t('Reviewing…', 'Revisando…') : t('Review with AI', 'Revisar con IA')}</Button>
        </> : <small>{t('Connect a model provider in Settings to review this PR.', 'Conecta un proveedor de modelos en Ajustes para revisar este PR.')}</small>}
        {aiError && <p role="alert">{aiError}</p>}
        {report && <div role="status"><p>{report.findings}</p><strong>{t('Verdict: ', 'Veredicto: ')}{report.verdict === 'approve' ? t('Recommend approval', 'Se recomienda aprobar') : report.verdict === 'changes' ? t('Request changes', 'Solicitar cambios') : t('Insufficient evidence', 'Información insuficiente')}</strong></div>}
      </fieldset>
      <fieldset disabled={busy}><legend>{t('Your review', 'Tu revisión')}</legend>
        <select aria-label={t('Review action', 'Acción de revisión')} value={action} onChange={e => setAction(e.target.value as typeof action)}>
          {pr.provider !== 'Azure Repos' && <option value="comment">{t('Comment', 'Comentar')}</option>}
          <option value="approve">{t('Approve', 'Aprobar')}</option>
          {pr.provider !== 'GitLab' && <option value="changes">{pr.provider === 'Azure Repos' ? t('Wait for author', 'Esperar al autor') : t('Request changes', 'Solicitar cambios')}</option>}
        </select>
        {withBody && <textarea aria-label={t('Review text', 'Texto de la revisión')} value={body} maxLength={10000} rows={3} onChange={e => setBody(e.target.value)} />}
        <Button disabled={busy || (withBody && action !== 'approve' && !body.trim())} onClick={send}>{t('Submit review', 'Enviar revisión')}</Button>
        <span role="status">{message}</span>
      </fieldset>
    </div>
  </section>
}
