import { requestMessageNavigation } from '../src/renderer/src/search-message-navigation'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '../src/renderer/src/chat-panel'
import { UIPreferences } from '../src/renderer/src/ui-preferences'
import type { AgentState, Conversation, PublicState } from '../src/shared/contracts'
import '../src/renderer/src/assets/main.css'
import '../src/renderer/src/assets/workspace-chrome.css'
import '../src/renderer/src/assets/chat-polish.css'
import '../src/renderer/src/assets/chat-accessibility.css'

const conversation: Conversation = {
  id: 'fixture', projectId: 'project', workspacePath: '/fixture', title: 'Test', createdAt: '',
  layout: { type: 'pane', id: 'pane', kind: 'chat' },
  messages: [{ id: 'partial', role: 'assistant', text: 'Resultado parcial conservado', notes: [], createdAt: '' }],
}
const state: PublicState = { worktreeVersion: 0, projects: [], conversations: [conversation], providers: [{ id: 'openai', model: 'fixture' }], agents: {}, chatgpt: { accounts: [] } }
function Fixture() {
  const [messages, setMessages] = useState(conversation.messages)
  const [agent, setAgent] = useState<AgentState>({ status: 'idle' })
  return <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="Simulación">{(['idle', 'running', 'waiting', 'error'] as const).map(status => <button key={status} onClick={() => setAgent({ status, detail: status === 'error' ? 'Fallo simulado' : undefined })}>{status}</button>)}</nav>
    <button onClick={() => requestMessageNavigation(conversation.id, "stream-0")}>Buscar primer mensaje</button><nav aria-label="Streaming"><button onClick={() => setMessages(Array.from({ length: 8 }, (_, index) => ({ id: `stream-${index}`, role: 'assistant' as const, text: `Mensaje ${index}\n\n` + 'Contenido de lectura. '.repeat(100), notes: [], createdAt: '' })))}>Cargar historial</button><button onClick={() => setMessages(current => current.map((message, index) => index === current.length - 1 ? { ...message, text: message.text + '\n\nFragmento nuevo. '.repeat(40) } : message))}>Fragmento</button></nav>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}><ChatPanel conversation={{ ...conversation, messages }} state={state} agent={agent} settings={() => {}} /></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<UIPreferences><Fixture /></UIPreferences>)
