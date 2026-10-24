import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import type { PublicState } from '../../shared/contracts'
import { AgentAccessSettings } from './agent-access-settings'
import { Button } from './components/ui/button'
import { Select } from './components/ui/input'
import { AppearanceSettings, useUI } from './ui-preferences'
import { NotificationSettings } from './notification-preferences'
import { HarnessSettings } from './harness-settings'
import './assets/settings-screen.css'

/** Keep the workspace mounted to preserve panel sessions. */
export function SettingsScreen({ state, onClose, children }: { state: PublicState; onClose: () => void; children: ReactNode }) {
  const { t } = useUI()
  const [section, setSection] = useState<'models' | 'access' | 'interface' | 'harnesses'>('models')
  const [conversationId, setConversationId] = useState(() => localStorage.getItem('alfred.conversation') || '')
  const heading = useRef<HTMLHeadingElement>(null)
  const conversation = state.conversations.find((item) => item.id === conversationId)
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const workspace = document.querySelector<HTMLElement>('.app-shell')
    const wasInert = workspace?.inert ?? false
    if (workspace) workspace.inert = true
    heading.current?.focus()
    return () => { if (workspace) workspace.inert = wasInert; if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  return createPortal(<main className="settings-screen" aria-labelledby="settings-title">
    <header className="settings-screen-header"><Button variant="ghost" onClick={onClose}><ArrowLeft size={18} />{t('Back to workspace', 'Volver al espacio')}</Button><h1 id="settings-title" ref={heading} tabIndex={-1}>{t('Settings', 'Ajustes')}</h1></header>
    <div className="settings-screen-layout">
      <nav className="settings-screen-nav" aria-label={t('Settings sections', 'Secciones de ajustes')}>
        {(['interface', 'models', 'harnesses', 'access'] as const).map((item) => <Button key={item} variant={section === item ? 'secondary' : 'ghost'} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item === 'interface' ? t('Interface', 'Interfaz') : item === 'models' ? t('Models and connections', 'Modelos y conexiones') : item === 'harnesses' ? 'Agent harnesses' : 'Terminal y MCP'.replace(' y ', t(' and ', ' y '))}</Button>)}
      </nav>
      <div className="settings-screen-content">
        <section hidden={section !== 'interface'} aria-labelledby="settings-interface-title"><h2 id="settings-interface-title">{t('Interface', 'Interfaz')}</h2><AppearanceSettings /><NotificationSettings /></section>
        <section hidden={section !== 'models'} aria-labelledby="settings-models-title"><h2 id="settings-models-title">{t('Models and connections', 'Modelos y conexiones')}</h2><p>{t('Connect your models. Keys are encrypted and stored only on the server.', 'Conecta tus modelos. Las claves se cifran y almacenan solo en el servidor.')}</p>{children}</section>
        {section === 'harnesses' && <section aria-labelledby="settings-harnesses-title"><h2 id="settings-harnesses-title">Agent harnesses</h2>
          <label>{t('Conversation', 'Conversación')}<Select value={conversation?.id || ''} onChange={(event) => setConversationId(event.target.value)}><option value="">{t('Select a conversation', 'Selecciona una conversación')}</option>{state.conversations.map((item) => <option key={item.id} value={item.id}>{state.projects.find((project) => project.id === item.projectId)?.name} · {item.title}</option>)}</Select></label>
          {conversation ? <HarnessSettings key={conversation.id} conversation={conversation} /> : <p>{t('Select a conversation to discover its harness resources.', 'Selecciona una conversación para descubrir sus recursos.')}</p>}
        </section>}
        <section hidden={section !== 'access'} aria-labelledby="settings-access-title">
          <h2 id="settings-access-title">{t('Agent access', 'Acceso del agente')}</h2>
          <p>{t('Terminal and MCP are configured per conversation, not globally. Select the conversation whose permissions you want to edit.', 'Terminal y MCP se configuran por conversación, no globalmente. Selecciona la conversación cuyos permisos quieres editar.')}</p>
          <label htmlFor="settings-conversation">{t('Conversation', 'Conversación')}</label>
          <Select id="settings-conversation" value={conversation?.id || ''} onChange={(event) => setConversationId(event.target.value)}><option value="">{t('Select a conversation', 'Selecciona una conversación')}</option>{state.conversations.map((item) => <option key={item.id} value={item.id}>{state.projects.find((project) => project.id === item.projectId)?.name || t('Project', 'Proyecto')} · {item.title}</option>)}</Select>
          {conversation && section === 'access' ? <AgentAccessSettings key={conversation.id} conversationId={conversation.id} /> : !conversation && <p role="status">{t('Select or create a conversation to configure its access.', 'Selecciona o crea una conversación para configurar su acceso.')}</p>}
        </section>
      </div>
    </div>
  </main>, document.body)
}
