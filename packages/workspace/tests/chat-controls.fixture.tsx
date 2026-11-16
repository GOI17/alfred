import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { UIPreferences } from '../src/renderer/src/ui-preferences'
import { ComposerInput } from '../src/renderer/src/composer-input'
import { ApprovalCard } from '../src/renderer/src/approval-card'
import '../src/renderer/src/assets/main.css'
import '../src/renderer/src/assets/workspace-chrome.css'
import '../src/renderer/src/assets/chat-polish.css'
import '../src/renderer/src/assets/chat-accessibility.css'

function Fixture() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  return <main className="chat-panel" style={{ width: '100%', maxWidth: 600, height: '100dvh', overflow: 'auto' }}>
    <ApprovalCard conversationId="fixture" approval={{ id: 'exact-operation', path: 'src/' + 'long-path/'.repeat(12) + 'file.ts', content: '<script>untrusted</script>' + 'x'.repeat(500) }} onError={setError} />
    {error && <p role="alert">{error}</p>}
    <div className="composer-wrap"><form className="composer" onSubmit={event => event.preventDefault()}>
      <ComposerInput conversationId="fixture" value={text} onChange={setText} sending={sending} busy={false} onSend={() => setSending(true)} settings={() => {}} />
      <div className="composer-footer"><div className="attachment-controls">
        <button className="context-control" type="button">Permisos de ejecución para esta conversación</button>
        <button className="model-picker-trigger" type="button"><span>Proveedor con un nombre de modelo especialmente largo</span></button>
      </div><button type="button" onClick={() => setSending(!sending)}>Alternar envío</button></div>
    </form></div>
  </main>
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(<UIPreferences><Fixture /></UIPreferences>)
