import { App } from '../src/renderer/src/app'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import FileSearch from '../src/renderer/src/file-search'
import { UIPreferences } from '../src/renderer/src/ui-preferences'
import type { Conversation, Project } from '../src/shared/contracts'
import '../src/renderer/src/assets/main.css'
const projects: Project[] = [{ id: 'p', name: 'Espacio A', path: '/repo', kind: 'git', createdAt: '' }]
const conversations: Conversation[] = [{ id: 'c', projectId: 'p', workspacePath: '/repo', title: 'Búsqueda contextual', createdAt: '', layout: { type: 'pane', kind: 'chat', id: 'pane' }, messages: [{ id: 'm', role: 'user', text: 'Revisar búsqueda de mensajes', notes: [], createdAt: '' }] }]
function Fixture() {
  const [open, setOpen] = useState(true), [selected, setSelected] = useState('')
  return <><button onClick={() => setOpen(true)}>Buscar</button><output>{selected}</output>{open && <FileSearch conversationId="c" projects={projects} conversations={conversations} close={() => setOpen(false)} select={result => { setSelected(JSON.stringify(result)); setOpen(false) }} />}</>
}
createRoot(document.getElementById('root')!).render(<UIPreferences>{new URLSearchParams(location.search).has('app') ? <App /> : <Fixture />}</UIPreferences>)
