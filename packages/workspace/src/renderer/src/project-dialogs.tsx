import { CopilotSettings } from './copilot-settings'
import { useEffect, useState } from 'react'
import type { Project, ProviderId, ApiProviderId, PublicState } from '../../shared/contracts'
import { apiProviderId } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { Input, Select } from './components/ui/input'
import { Dialog } from './components/ui/dialog'
import { ChatgptSettings } from './chatgpt-settings'
import { SettingsScreen } from './settings-screen'
import { useUI } from './ui-preferences'

export function WorktreeDialog({ project, onClose, onAdded }: {
  project: Project; onClose: () => void; onAdded: (path: string) => void
}) {
  const { t } = useUI()
  const [branch, setBranch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [defaultPath, setDefaultPath] = useState(''), [customPath, setCustomPath] = useState('')
  const [custom, setCustom] = useState(false), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void api<{ path: string }>(`/projects/${project.id}/worktrees/location`, undefined, undefined, controller.signal)
      .then((location) => { if (!controller.signal.aborted) setDefaultPath(location.path) })
      .catch((error) => { if (!controller.signal.aborted) setError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [project.id, attempt])
  const destination = custom ? customPath : defaultPath
  return <Dialog open onClose={onClose} title={t('New worktree', 'Nuevo worktree')}
    description={t('An independent branch and folder for parallel work, starting from the current project commit.', 'Una rama y carpeta independientes para trabajar en paralelo, desde el commit actual del proyecto.')}>
    <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy || loading || !destination.trim()) return
      setBusy(true); setError('')
      try {
        const result = await api<{ path: string }>(`/projects/${project.id}/worktrees`, { branch, path: destination })
        onAdded(result.path); onClose()
      } catch (error) { setError(errorMessage(error)) }
      finally { setBusy(false) }
    }}>
      <label>{t('New branch name', 'Nombre de la nueva rama')}<Input required disabled={busy} maxLength={150} value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-idea" autoComplete="off" /></label>
      <div className="worktree-location">
        <div className="worktree-location-heading"><span>{t('Worktree folder', 'Carpeta del worktree')}</span>
          <Button variant="ghost" size="small" disabled={busy || loading || !defaultPath} onClick={() => {
            if (!custom) setCustomPath(defaultPath)
            setCustom(!custom)
          }}>{custom ? t('Use default', 'Usar predeterminada') : t('Change path', 'Cambiar ruta')}</Button>
        </div>
        {loading ? <p className="field-note" role="status">{t('Loading default location…', 'Cargando ubicación predeterminada…')}</p>
          : custom ? <Input aria-label={t('Worktree path', 'Ruta del worktree')} aria-describedby="worktree-location-note" autoFocus required disabled={busy} maxLength={4000} value={customPath} onChange={(event) => setCustomPath(event.target.value)} autoComplete="off" spellCheck={false} />
          : defaultPath ? <code className="worktree-location-path">{defaultPath}</code>
          : <Button variant="secondary" size="small" onClick={() => setAttempt((value) => value + 1)}>{t('Retry loading location', 'Reintentar cargar ubicación')}</Button>}
        <p id="worktree-location-note" className="field-note">{custom
          ? t('Enter the full path of a new folder on the computer running Alfred. The folder must not exist yet. This change applies only to this worktree.', 'Escribe la ruta completa de una carpeta nueva en el equipo donde se ejecuta Alfred. La carpeta no debe existir todavía. Este cambio solo se aplica a este worktree.')
          : t('By default, Alfred creates a unique folder inside worktrees in its data directory. The full destination is shown above.', 'Por defecto, Alfred crea una carpeta única dentro de worktrees en su directorio de datos. Arriba se muestra la ruta completa de destino.')}</p>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>{t('Cancel', 'Cancelar')}</Button>
        <Button type="submit" disabled={busy || loading || !destination.trim()}>{busy ? t('Creating…', 'Creando…') : t('Create worktree', 'Crear worktree')}</Button>
      </div>
    </form>
  </Dialog>
}
export const providerNames: Record<ProviderId, string> = {
  copilot: 'GitHub Copilot', opencode: 'OpenCode Zen', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', chatgpt: 'ChatGPT',
}
const providerLinks: Record<ApiProviderId, string> = {
  copilot: 'https://github.com/settings/copilot',
  opencode: 'https://opencode.ai/auth',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
}
// Retain the existing entry point while rendering a dedicated screen, not a dialog.
export function SettingsDialog({ state, onClose }: { state: PublicState; onClose: () => void }) {
  const { t } = useUI()
  const [provider, setProvider] = useState<ApiProviderId>('openai'), [key, setKey] = useState(''),
    [model, setModel] = useState(state.providers.find((item) => item.id === 'openai')?.model || ''),
    [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false)
  return <SettingsScreen state={state} onClose={onClose}>
    <ChatgptSettings state={state} />
    <CopilotSettings state={state} />
    <div className="section-label">{t('CONNECT AN API', 'CONECTAR UNA API')}</div>
    <div className="provider-summary">
      {state.providers.map((item) => <span key={item.id} className="badge"><span className="status-dot" data-status="idle" />{providerNames[item.id]} · {item.model}</span>)}
      {!state.providers.length && <span className="muted">{t('No providers connected yet.', 'Todavía no hay proveedores conectados.')}</span>}
    </div>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setSaved(false)
      try { await api(`/providers/${provider}`, { apiKey: key, model }, 'PUT'); setKey(''); setSaved(true) }
      catch (error) { setError(errorMessage(error)) }
      finally { setBusy(false) }
    }}>
      <label>{t('Provider', 'Proveedor')}<Select value={provider} onChange={(event) => {
        const next = apiProviderId.parse(event.target.value)
        setProvider(next); setModel(state.providers.find((item) => item.id === next)?.model || ''); setKey(''); setSaved(false)
      }}>
        {Object.entries(providerNames).filter(([id]) => id !== 'chatgpt' && id !== 'copilot').map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select></label>
      <label>{t('Model ID', 'ID del modelo')}<Input required value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('Model available in your account', 'Modelo disponible en tu cuenta')} /></label>
      <label>{t('API key', 'Clave API')}<Input required type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" placeholder={t('Paste your API key', 'Pega tu clave API')} /></label>
      <a className="text-link" href={providerLinks[provider]} target="_blank" rel="noreferrer">{t('Get an API key from', 'Obtener una clave API de')} {providerNames[provider]} ↗</a>
      <p className="field-note">{t('API key usage is billed to your provider account, separately from your ChatGPT.', 'El uso de la clave API se factura en tu cuenta del proveedor, por separado de ChatGPT.')}</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      {saved && <p role="status">{t('Connection saved. It will be verified when you send your first message.', 'Conexión guardada. Se verificará al enviar tu primer mensaje.')}</p>}
      <div className="dialog-actions">
        {state.providers.some((item) => item.id === provider) && <Button variant="danger" onClick={() => {
          void api(`/providers/${provider}`, undefined, 'DELETE').catch((error) => setError(errorMessage(error)))
        }}>{t('Disconnect', 'Desconectar')}</Button>}
        <Button type="submit" disabled={busy}>{busy ? t('Saving…', 'Guardando…') : t('Save connection', 'Guardar conexión')}</Button>
      </div>
    </form>
  </SettingsScreen>
}
