import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { App } from './app'
import './assets/main.css'
import './assets/panel-content.css'
import './assets/chat-polish.css'
import { UIPreferences, useUI } from './ui-preferences'
import { useWorkspace } from './use-workspace'
import { ChatPanel } from './chat-panel'
import { Login } from './device-connection'
import { SettingsDialog } from './project-dialogs'
import { Button } from './components/ui/button'
import { NotificationPreferences } from './notification-preferences'

/** A separate client: no workspace selection or layout persistence side effects. */
function DetachedChat({ id }: { id: string }) {
  const { t } = useUI()
  const { state, authenticated, connected, refresh } = useWorkspace()
  const [settings, setSettings] = useState(false)
  const conversation = state?.conversations.find((item) => item.id === id)
  useEffect(() => {
    document.title = conversation ? `${conversation.title} — Alfred` : 'Chat — Alfred'
  }, [conversation?.title])
  if (authenticated === undefined) return <div className="loading-screen">{t('Opening chat…', 'Abriendo chat…')}</div>
  if (!authenticated || !state) return <Login connected={refresh} />
  return <NotificationPreferences><main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', minWidth: 0, overflow: 'hidden' }}>
    <header className="workspace-header">
      <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation?.title || t('Chat unavailable', 'Chat no disponible')}</strong>
      <Button variant="ghost" size="small" onClick={() => setSettings(true)}>{t('Settings', 'Ajustes')}</Button>
      <Button variant="ghost" size="small" onClick={() => window.close()}>{t('Close window', 'Cerrar ventana')}</Button>
    </header>
    {!connected && <div className="connection-banner" role="status">{t('Disconnected from the server.', 'Desconectado del servidor.')}</div>}
    {conversation ? <div className="studio-chat" style={{ flex: 1, minHeight: 0 }}><ChatPanel conversation={conversation} state={state} agent={state.agents[id]} settings={() => setSettings(true)} /></div>
      : <p role="status">{t('This conversation no longer exists or is unavailable.', 'Esta conversación ya no existe o no está disponible.')}</p>}
    {settings && <SettingsDialog state={state} onClose={() => setSettings(false)} />}
  </main></NotificationPreferences>
}

const root = document.getElementById('root')
if (!root) throw new Error('Alfred root container was not found.')
const detachedId = new URLSearchParams(window.location.search).get('chatWindow')
createRoot(root).render(<UIPreferences>{detachedId ? <DetachedChat id={detachedId} /> : <App />}</UIPreferences>)
