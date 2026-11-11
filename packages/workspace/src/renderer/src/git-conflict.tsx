import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

type Conflict = { content: string; snapshot: string; versions: Record<string, string | null> }
export function GitConflict({ endpoint, path, close, saved }: {
  endpoint: string; path: string; close: () => void; saved: () => void
}) {
  const { t } = useUI()
  const [source, setSource] = useState<Conflict>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<{ output: string }>(`${endpoint}/git/action`, { action: 'conflict-read', path }, undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        const value = JSON.parse(result.output) as Conflict
        setSource(value)
        setDraft(value.content)
      }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)) })
    return () => controller.abort()
  }, [endpoint, path])
  return <section className="git-branch-card" aria-label={t('Conflict editor', 'Editor de conflictos')}>
    <h3>{path}</h3>
    <p>{t('Stage 2 is the current side; stage 3 is the incoming side. During rebase, stage 2 is the target branch and stage 3 is the commit being replayed. Saving does not stage or commit.', 'La etapa 2 es el lado actual; la etapa 3 es el entrante. Durante rebase, la etapa 2 es la rama destino y la etapa 3 el commit que se reaplica. Guardar no prepara ni crea un commit.')}</p>
    {error && <p role="alert">{error}</p>}
    {!source && !error && <p role="status">{t('Loading conflict…', 'Cargando conflicto…')}</p>}
    {source && <>
      {(['1', '2', '3'] as const).map(stage => <details key={stage}>
        <summary>{stage === '1' ? t('Base', 'Base') : stage === '2' ? t('Stage 2 · current side', 'Etapa 2 · lado actual') : t('Stage 3 · incoming side', 'Etapa 3 · lado entrante')}</summary>
        {source.versions[stage] === null ? <p>{t('File absent in this version', 'Archivo ausente en esta versión')}</p> : <>
          <pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{source.versions[stage]}</pre>
          <Button size="small" variant="secondary" disabled={busy} onClick={() => {
            if (window.confirm(t('Replace the entire result with this version?', '¿Reemplazar todo el resultado por esta versión?'))) setDraft(source.versions[stage]!)
          }}>{t('Use this version', 'Usar esta versión')}</Button>
        </>}
      </details>)}
      <label>{t('Editable result', 'Resultado editable')}
        <textarea className="input" rows={18} spellCheck={false} value={draft} disabled={busy} maxLength={100000} onChange={event => setDraft(event.target.value)} />
      </label>
      <Button disabled={busy} onClick={async () => {
        setBusy(true)
        setError('')
        try {
          await api(`${endpoint}/git/action`, { action: 'conflict-save', path, snapshot: source.snapshot, content: draft })
          saved()
        } catch (cause) { setError(errorMessage(cause)) }
        finally { setBusy(false) }
      }}>{t('Save result without staging', 'Guardar resultado sin preparar')}</Button>
    </>}
    <Button variant="secondary" disabled={busy} onClick={() => {
      if (!source || draft === source.content || window.confirm(t('Close and discard the unsaved draft?', '¿Cerrar y descartar el borrador sin guardar?'))) close()
    }}>{t('Close', 'Cerrar')}</Button>
  </section>
}
