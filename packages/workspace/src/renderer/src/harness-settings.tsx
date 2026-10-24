import { useEffect, useState } from 'react'
import type { Conversation } from '../../shared/contracts'
import type { AgentAccess } from '../../shared/agent-access'
import { harnessNames, type HarnessCatalog, type HarnessId, type HarnessResource, type HarnessResourceKind, type HarnessResourcePreview, type HarnessSelection } from '../../shared/harnesses'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { Select } from './components/ui/input'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'
import { liveRefresh } from './live-refresh'
import './assets/harness-settings.css'

export function HarnessSettings({ conversation }: { conversation: Conversation }) {
  const { t } = useUI()
  const [catalog, setCatalog] = useState<HarnessCatalog>()
  const [harness, setHarness] = useState<HarnessId>(conversation.harness?.id || 'codex')
  const [kind, setKind] = useState<HarnessResourceKind>('skill')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<HarnessResourcePreview>()
  useEffect(() => liveRefresh(async (signal) => {
    const next = await api<HarnessCatalog>(`/conversations/${conversation.id}/harnesses`, undefined, 'GET', signal)
    if (!signal.aborted) setCatalog(next)
  }, (error) => setError(errorMessage(error)), 15000), [conversation.id])
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  async function select(selection: HarnessSelection | null) {
    await api(`/conversations/${conversation.id}/harness`, { selection }, 'PUT')
    setNotice(selection ? t('Harness resources enabled for this conversation.', 'Recursos del harness habilitados para esta conversación.') : t('Using Alfred without imported harness instructions.', 'Usando Alfred sin instrucciones importadas del harness.'))
  }
  async function importMcp(resource: HarnessResource) {
    const access = await api<AgentAccess>(`/conversations/${conversation.id}/agent-access`)
    const existing = access.servers.find((item) => item.transport.type === 'harness' && item.transport.resourceId === resource.id)
    const server = {
      id: existing?.id || `${resource.harness}_${resource.id.slice(0, 12)}`,
      transport: { type: 'harness' as const, harness: resource.harness, resourceId: resource.id, fingerprint: resource.fingerprint },
      permission: existing?.permission || 'ask' as const,
      tools: existing?.tools || {},
    }
    await api(`/conversations/${conversation.id}/agent-access`, {
      confirmed: true,
      access: { ...access, servers: [...access.servers.filter((item) => item.id !== server.id), server] },
    }, 'PUT')
    setNotice(t('MCP reference saved. Manage its permissions in Terminal and MCP. It connects on the next run.', 'Referencia MCP guardada. Gestiona sus permisos en Terminal y MCP. Se conectará en la próxima ejecución.'))
  }
  const kinds: { id: HarnessResourceKind; label: string }[] = [
    { id: 'skill', label: 'Skills' }, { id: 'command', label: t('Commands', 'Comandos') },
    { id: 'agent', label: t('Agent definitions', 'Definiciones de agentes') },
    { id: 'instruction', label: t('Instructions', 'Instrucciones') }, { id: 'mcp', label: 'MCP' },
  ]
  const info = catalog?.harnesses.find((item) => item.id === harness)
  const resources = catalog?.resources.filter((item) => item.harness === harness && item.kind === kind) || []
  const active = conversation.harness?.id === harness
  return <div className="harness-settings">
    <p>{t('Discover resources installed on the Alfred server and in this workspace. Choose which harness supplies this conversation’s prompts and skills.', 'Descubre los recursos instalados en el servidor de Alfred y en este workspace. Elige qué harness aporta las instrucciones y skills de esta conversación.')}</p>
    <div className="harness-toolbar">
      <label>{t('Harness', 'Harness')}<Select value={harness} onChange={(event) => { const found = catalog?.harnesses.find((item) => item.id === event.target.value); if (found) setHarness(found.id) }}>
        {Object.entries(harnessNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select></label>
      <Button variant="secondary" disabled={busy} onClick={() => void act(async () => setCatalog(await api<HarnessCatalog>(`/conversations/${conversation.id}/harnesses?refresh=true`)))}>{t('Refresh resources', 'Actualizar recursos')}</Button>
    </div>
    {info && <p className="field-note">{info.installed ? t('CLI detected', 'CLI detectado') : info.configured ? t('Configuration found; CLI not on PATH', 'Configuración encontrada; CLI fuera del PATH') : t('CLI not detected; shared resources may still be available', 'CLI no detectado; puede haber recursos compartidos')}{info.executable && <> · <code>{info.executable}</code></>}</p>}
    <div className="harness-toolbar">
      <Button disabled={busy || !catalog || active} onClick={() => void act(() => select({ id: harness, instructions: true }))}>{active ? t('Enabled for this conversation', 'Habilitado en esta conversación') : t('Use these resources', 'Usar estos recursos')}</Button>
      {conversation.harness && <Button variant="ghost" disabled={busy} onClick={() => void act(() => select(null))}>{t('Use Alfred defaults', 'Usar valores de Alfred')}</Button>}
    </div>
    {active && <label className="harness-checkbox"><input type="checkbox" disabled={busy} checked={conversation.harness?.instructions !== false} onChange={(event) => void act(() => select({ ...conversation.harness!, instructions: event.target.checked }))} />{t('Load workspace and user instructions on each turn', 'Cargar instrucciones del workspace y del usuario en cada turno')}</label>}
    <p className="field-note">{t('Alfred runs these prompts with the model and permissions selected in this conversation. Native CLI hooks, extensions and orchestration remain in their harness.', 'Alfred usa estas instrucciones con el modelo y permisos de esta conversación. Los hooks, extensiones y la orquestación nativa siguen en su harness.')}</p>
    <nav className="harness-kinds" aria-label={t('Resource types', 'Tipos de recursos')}>{kinds.map((item) => <Button key={item.id} size="small" variant={kind === item.id ? 'secondary' : 'ghost'} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label} <span>{catalog?.resources.filter((resource) => resource.harness === harness && resource.kind === item.id).length || 0}</span></Button>)}</nav>
    {!catalog && <p role="status">{t('Scanning harness resources…', 'Buscando recursos de los harnesses…')}</p>}
    {catalog && !resources.length && <p role="status">{t('No resources of this type were found.', 'No se encontraron recursos de este tipo.')}</p>}
    {kind === 'agent' && <p className="field-note">{t('These are reusable definitions. Running subagents appear in Changes and activity when their harness publishes updates.', 'Estas son definiciones reutilizables. Los subagentes en ejecución aparecen en Cambios y actividad cuando su harness publica actualizaciones.')}</p>}
    {kind === 'mcp' && <p className="field-note">{t('Importing saves a reference, stops the current run and pauses its queue. It does not connect yet. Credentials stay on the server.', 'Importar guarda una referencia, detiene la ejecución actual y pausa su cola. Todavía no conecta. Las credenciales permanecen en el servidor.')}</p>}
    <ul className="harness-resource-list">{resources.map((resource) => <li key={resource.id}>
      <div className="harness-resource-heading"><strong>{resource.name}</strong><span>{resource.scope === 'user' ? t('User', 'Usuario') : 'Workspace'}</span></div>
      <p>{resource.description}</p><code className="harness-source">{resource.source}</code>
      {resource.invocation && <code>{resource.invocation}</code>}
      {resource.shadowedBy && <p className="field-note">{t('Another definition takes precedence.', 'Otra definición tiene prioridad.')}</p>}
      {resource.reason && <p className="field-note">{resource.reason}</p>}
      {resource.details?.map((detail) => <p className="field-note" key={detail}>{detail}</p>)}
      <div className="harness-toolbar">
        <Button variant="ghost" size="small" disabled={busy} onClick={() => void act(async () => setPreview(await api<HarnessResourcePreview>(`/conversations/${conversation.id}/harnesses/resources/${resource.id}`)))}>{resource.kind === 'mcp' ? t('Connection details', 'Detalles de conexión') : t('View source', 'Ver contenido')}</Button>
        {resource.kind === 'agent' && <Button variant="secondary" size="small" disabled={busy || !resource.usable || !!resource.shadowedBy} onClick={() => void act(() => select({ id: harness, agent: resource.id, instructions: conversation.harness?.instructions ?? true }))}>{active && conversation.harness?.agent === resource.id ? t('Selected agent prompt', 'Instrucciones seleccionadas') : t('Use agent prompt', 'Usar instrucciones del agente')}</Button>}
        {resource.kind === 'mcp' && <Button variant="secondary" size="small" disabled={busy || !resource.usable || !!resource.shadowedBy} onClick={() => void act(() => importMcp(resource))}>{t('Import MCP', 'Importar MCP')}</Button>}
      </div>
    </li>)}</ul>
    {active && conversation.harness?.agent && <Button variant="ghost" disabled={busy} onClick={() => void act(() => select({ id: harness, instructions: conversation.harness?.instructions ?? true }))}>{t('Clear agent prompt', 'Quitar instrucciones del agente')}</Button>}
    {!!catalog?.issues.length && <details className="harness-issues"><summary>{t('Discovery notices', 'Avisos de detección')} ({catalog.issues.length})</summary>{catalog.issues.map((issue, index) => <p key={index}><code>{issue.source}</code><br />{issue.message}</p>)}</details>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}
    {preview && <Dialog open onClose={() => setPreview(undefined)} title={preview.resource.name} description={preview.resource.source}><pre className="harness-preview">{preview.content}</pre></Dialog>}
  </div>
}
