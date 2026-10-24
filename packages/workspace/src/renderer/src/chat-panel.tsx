import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Square, Sparkles, FileCheck2, Check, X, Paperclip } from 'lucide-react'
import type { AgentState, Conversation, PublicState, ProviderId } from '../../shared/contracts'
import { attachmentMediaType, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, type Attachment } from '../../shared/attachments'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { ComposerInput } from './composer-input'
import { ModelPicker } from './model-picker'
import { SubagentsPanel } from './subagents-panel'
import { MessageNavigation } from './message-navigation'
import { ContextPermissions } from './context-permissions'
import { useUI } from './ui-preferences'
import { useChatReading } from './use-chat-reading'
import './assets/attachments.css'
import './assets/message-queue.css'
import './assets/message-phases.css'

const Markdown = lazy(() => import('./message-markdown'))
type Props = { conversation: Conversation; state: PublicState; agent?: AgentState; settings: () => void }
export function ChatPanel(props: Props) { return <ConversationChat key={props.conversation.id} {...props} /> }
function ApprovalCard({ approval, conversationId, onError }: {
  approval: NonNullable<AgentState['approval']>; conversationId: string; onError: (message: string) => void
}) {
  const { t } = useUI()
  const operation = /^(Connect MCP:|MCP:|Terminal:)/.test(approval.path)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  // Never infer permission from preview content. Decisions reference this exact approval ID.
  let files: { path: string; content: string }[] | undefined
  if (/^Batch of \d+ file\(s\)$/.test(approval.path)) {
    try {
      const parsed: unknown = JSON.parse(approval.content)
      if (parsed && typeof parsed === 'object' && 'files' in parsed && Array.isArray(parsed.files) && parsed.files.length > 0 &&
        parsed.files.every((file: unknown): file is { path: string; content: string } => !!file && typeof file === 'object' && 'path' in file && typeof file.path === 'string' && 'content' in file && typeof file.content === 'string')) files = parsed.files
    } catch { /* Fall back to the exact original preview. */ }
  }
  async function decide(accepted: boolean) {
    if (lock.current) return
    lock.current = true; setSaving(true)
    try { await api(`/conversations/${conversationId}/approval`, { approvalId: approval.id, accepted }) }
    catch (error) { onError(errorMessage(error)) }
    finally { lock.current = false; setSaving(false) }
  }
  return <div className="approval-card">
    <div><FileCheck2 size={18} /><strong>{operation ? t('Authorize operation', 'Autorizar operación') : t('Review changes', 'Revisar cambios')}</strong></div>
    {files ? <>
      <p>{t(`The runtime proposes saving ${files.length} file(s). This approval covers only the contents shown.`, `El runtime propone guardar ${files.length} archivo(s). Esta aprobación cubre solo el contenido mostrado.`)}</p>
      {files.map((file, index) => <details key={index}><summary><code>{file.path}</code> · {t('View proposed content', 'Ver contenido propuesto')}</summary><pre>{file.content}</pre></details>)}
      <p>{t('Saving is not atomic: if a file fails, successfully saved files will be reported.', 'El guardado no es atómico: si un archivo falla, se informarán los archivos guardados correctamente.')}</p>
    </> : <>
      <p>{operation ? t('The runtime requests authorization for', 'El runtime solicita autorización para') : t('The runtime proposes saving', 'El runtime propone guardar')} <code>{approval.path}</code></p>
      <details><summary>{t('View proposed content', 'Ver contenido propuesto')}</summary><pre>{approval.content}</pre></details>
    </>}
    {approval.path.startsWith('Connect MCP:') && <p>{t('Authorize the connection for this conversation during the server session. Changing the configuration revokes this authorization. Tool calls retain their own permissions.', 'Autoriza la conexión para esta conversación durante la sesión del servidor. Cambiar la configuración revoca esta autorización. Las llamadas a herramientas conservan sus propios permisos.')}</p>}
    <div className="approval-actions">
      <Button variant="secondary" size="small" disabled={saving} onClick={() => void decide(false)}><X size={14} />{files ? t('Reject all', 'Rechazar todo') : t('Reject', 'Rechazar')}</Button>
      <Button size="small" disabled={saving} onClick={() => void decide(true)}><Check size={14} />{operation ? t('Authorize', 'Autorizar') : files ? t('Approve and save all', 'Aprobar y guardar todo') : t('Save file', 'Guardar archivo')}</Button>
    </div>
  </div>
}
function ConversationChat({ conversation, state, agent, settings }: Props) {
  const { t, language } = useUI()
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(`alfred.draft.${conversation.id}`) || '' } catch { return '' } })
  const [provider, setProvider] = useState<ProviderId>(conversation.lastProvider || state.providers[0]?.id || 'openai')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [queueAction, setQueueAction] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const readingLock = useRef(false)
  const sendLock = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const messageContent = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const follow = useChatReading(conversation.id, scroller, messageContent)
  const busy = agent?.status === 'running' || agent?.status === 'waiting'
  const queue = conversation.queue || []
  const configured = state.providers.some((item) => item.id === provider)
  const canSend = !sending && !reading && !queueAction && (!!text.trim() || !!attachments.length)
  useEffect(() => { try { sessionStorage.setItem(`alfred.draft.${conversation.id}`, text) } catch { /* Storage may be unavailable. */ } }, [conversation.id, text])
  function scrollToLatest() { const element = scroller.current; if (element) element.scrollTop = element.scrollHeight }
  useLayoutEffect(() => { if (follow.current) scrollToLatest() }, [conversation.messages, agent?.approval, agent?.status, queue, text, attachments, sending, error])
  useLayoutEffect(() => {
    const element = scroller.current, content = messageContent.current
    if (!element || !content) return
    const observer = new ResizeObserver(() => { if (follow.current) scrollToLatest() })
    observer.observe(element); observer.observe(content)
    return () => observer.disconnect()
  }, [])
  async function act(path: string, body: object = {}) {
    setQueueAction(true); setError('')
    try { await api(`/conversations/${conversation.id}/${path}`, body) }
    catch (error) { setError(errorMessage(error)) }
    finally { setQueueAction(false) }
  }
  async function addFiles(files: File[]) {
    if (readingLock.current || sendLock.current) return
    readingLock.current = true; setReading(true); setError('')
    try {
      if (files.length + attachments.length > MAX_ATTACHMENTS) throw new Error(t('You can attach up to 4 files per message.', 'Puedes adjuntar hasta 4 archivos por mensaje.'))
      const existingSize = attachments.reduce((sum, file) => sum + atob(file.data).length, 0)
      if (existingSize + files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error(t('Attachments cannot exceed 4 MB per message.', 'Los adjuntos no pueden superar 4 MB por mensaje.'))
      const added: Attachment[] = []
      for (const file of files) {
        if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name}: ${t('the file must be between 1 byte and 2 MB.', 'el archivo debe tener entre 1 byte y 2 MB.')}`)
        const mediaType = attachmentMediaType(file.name, file.type)
        if (file.name.length > 255) throw new Error(t('The file name is too long.', 'El nombre del archivo es demasiado largo.'))
        if (mediaType === 'text/plain') {
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (bytes.includes(0)) throw new Error(`${file.name}: ${t('not a text file.', 'no es un archivo de texto.')}`)
          try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
          catch { throw new Error(`${file.name}: ${t('use UTF-8 encoded text.', 'usa texto codificado en UTF-8.')}`) }
        }
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error(`${t('Could not read', 'No se pudo leer')} ${file.name}.`))
          reader.onabort = () => reject(new Error(t('Reading canceled.', 'Lectura cancelada.')))
          reader.onload = () => resolve(String(reader.result).split(',')[1])
          reader.readAsDataURL(file)
        })
        added.push({ name: file.name, mediaType, data })
      }
      setAttachments((current) => [...current, ...added])
    } catch (error) { setError(errorMessage(error)) }
    finally { readingLock.current = false; setReading(false) }
  }
  async function send() {
    if ((!text.trim() && !attachments.length) || readingLock.current || sendLock.current || queueAction) return
    if (!configured) { settings(); return }
    composer.current?.querySelector('textarea')?.focus({ preventScroll: true })
    sendLock.current = true; setSending(true); setError(''); follow.current = true; scrollToLatest()
    try {
      await api(`/conversations/${conversation.id}/messages`, { text, provider, attachments, mode: 'queue' })
      setText(''); setAttachments([])
    } catch (error) { setError(errorMessage(error)) }
    finally { sendLock.current = false; setSending(false) }
  }
  const sendLabel = busy || queue.length || conversation.queuePaused ? t('Queue message', 'Poner mensaje en cola') : t('Send message', 'Enviar mensaje')
  return <div className="chat-panel">
    <div className="message-history">
      <div className="messages" ref={scroller} onScroll={() => {
        const element = scroller.current
        if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
      }}>
        <div ref={messageContent} style={{ display: 'flow-root' }}>
          {!conversation.messages.length && <div className="chat-welcome">
            <span className="welcome-symbol"><Sparkles size={27} strokeWidth={1.4} /></span>
            <p className="eyebrow">{t('A SPACE TO THINK AND CREATE', 'UN ESPACIO PARA PENSAR Y CREAR')}</p>
            <h1>{t('What shall we build today?', '¿Qué construimos hoy?')}</h1>
            <p>{t('An idea, a problem, the next step.', 'Una idea, un problema, el siguiente paso.')}<br />{t('It all starts here, in your project.', 'Todo empieza aquí, en tu proyecto.')}</p>
            <div className="prompt-suggestions">{[t('Explore this project', 'Explora este proyecto'), t('Help me plan a feature', 'Ayúdame a planear una funcionalidad'), t('Review the code and suggest improvements', 'Revisa el código y sugiere mejoras')].map((prompt) => <button key={prompt} onClick={() => setText(prompt)}>{prompt}<span>↗</span></button>)}</div>
          </div>}
          {conversation.messages.map((message) => <article key={message.id} className="message" data-role={message.role} data-message-id={message.id}>
            <div className="message-avatar">{message.role === 'user' ? t('You', 'Tú') : 'a·'}</div>
            <div className="message-content">
              <div className="message-heading">{message.role === 'user' ? t('You', 'Tú') : t('Assistant', 'Asistente')}<time>{new Date(message.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</time></div>
              {!!message.attachments?.length && <div className="attachment-list" aria-label={t('Attachments', 'Adjuntos')}>
                {message.attachments.map((file, index) => <a className="attachment-chip" key={index} download={file.name} href={`data:${file.mediaType};base64,${file.data}`} title={`${t('Download', 'Descargar')} ${file.name}`}><Paperclip size={14} /><span>{file.name}</span></a>)}
              </div>}
              {message.role === 'assistant' && message.segments?.length ? <div className="message-phases">
                {message.segments.some((segment) => segment.kind === 'activity') && <details className="message-activity" open={busy && message === conversation.messages.at(-1) ? true : undefined}>
                  <summary>{t('Activity', 'Actividad')}</summary>
                  {message.segments.filter((segment) => segment.kind === 'activity').map((segment, index) => <div className="markdown message-phase" key={index}><Suspense fallback={<p>{segment.text}</p>}><Markdown conversationId={conversation.id}>{segment.text}</Markdown></Suspense></div>)}
                </details>}
                {message.segments.filter((segment) => segment.kind !== 'activity').map((segment, index) => <section className="message-result" key={index}>
                  <h3>{segment.kind === 'result' ? t('Result', 'Resultado') : busy && message === conversation.messages.at(-1) ? t('Response in progress', 'Respuesta en curso') : t('Partial response', 'Respuesta parcial')}</h3>
                  <div className="markdown"><Suspense fallback={<p>{segment.text}</p>}><Markdown conversationId={conversation.id}>{segment.text}</Markdown></Suspense></div>
                </section>)}
              </div> : <div className="markdown"><Suspense fallback={<p>{message.text}</p>}><Markdown conversationId={conversation.id}>{message.text}</Markdown></Suspense></div>}
              {message.notes.length > 0 && <details className="tool-notes"><summary>{t('Tool log and notices', 'Herramientas y avisos')} · {message.notes.length}</summary>{message.notes.map((note, index) => <p key={index}>{note}</p>)}</details>}
            </div>
          </article>)}
          <SubagentsPanel projections={conversation.subagents} />
          {agent?.status === 'running' && <div className="agent-progress"><span className="status-dot" data-status="running" />{t('Runtime is working…', 'El runtime está trabajando…')}</div>}
          {agent?.approval && <ApprovalCard key={agent.approval.id} approval={agent.approval} conversationId={conversation.id} onError={setError} />}
        </div>
      </div>
      <MessageNavigation messages={conversation.messages} scroller={scroller} content={messageContent} onNavigate={() => { follow.current = false }} />
    </div>
    <div className="composer-wrap">
      {error && <p role="alert" className="error-text">{error}</p>}
      {agent?.status === 'error' && agent.detail && <p role="alert" className="error-text">{agent.detail}</p>}
      {!!queue.length && <section className="message-queue" aria-label={t('Queued messages', 'Mensajes en cola')}>
        <div className="message-queue-heading"><span role="status">{conversation.queuePaused ? t('Queue paused', 'Cola pausada') : t('Queued', 'En cola')} · {queue.length}</span>{!busy && <Button type="button" variant="secondary" size="small" disabled={queueAction || sending} onClick={() => void act('queue/resume')}>{t('Resume queue', 'Reanudar cola')}</Button>}</div>
        <ol>{queue.map((item) => <li key={item.id}>
          <span title={item.text || item.attachments.map((file) => file.name).join(', ')}>{item.text || item.attachments.map((file) => file.name).join(', ')}{item.text && item.attachments.length > 0 ? ` · ${item.attachments.length} ${t('attachment(s)', 'adjunto(s)')}` : ''}</span>
          <Button type="button" variant="secondary" size="icon" aria-label={`${t('Remove from queue', 'Quitar de la cola')}: ${(item.text || item.attachments[0]?.name || t('Message', 'Mensaje')).slice(0, 80)}`} disabled={queueAction || sending} onClick={() => void act('queue/remove', { messageId: item.id })}><X size={14} /></Button>
        </li>)}</ol>
      </section>}
      <form ref={composer} className={`composer${dragging ? ' composer-dragging' : ''}`}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = sending || reading ? 'none' : 'copy'; setDragging(!sending && !reading) } }}
        onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)) }}
        onPaste={(event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) return
          const files = Array.from(event.clipboardData.files)
          if (!files.length) return
          event.preventDefault(); void addFiles(files)
        }}
        onSubmit={(event) => { event.preventDefault(); void send() }}>
        {dragging && <div className="attachment-drop-hint">{t('Drop files to attach them', 'Suelta archivos para adjuntarlos')}</div>}
        {!!attachments.length && <div className="attachment-list" aria-label={t('Pending attachments', 'Adjuntos pendientes')}>
          {attachments.map((file, index) => <span className="attachment-chip" key={index}><Paperclip size={14} /><span title={file.name}>{file.name}</span><button type="button" disabled={sending || reading} aria-label={`${t('Remove', 'Quitar')} ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><X size={14} /></button></span>)}
        </div>}
        <ComposerInput conversationId={conversation.id} harness={conversation.harness} value={text} onChange={setText} sending={sending} busy={busy} onSend={() => void send()} settings={settings} />
        <div className="composer-footer">
          <div className="attachment-controls">
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
            <span className="context-control" title={t('Execution is provided by the configured runtime adapter', 'La ejecución corresponde al adaptador de runtime configurado')}>{t('Runtime', 'Runtime')}</span>
            <ModelPicker state={state} provider={provider} onSelect={setProvider} settings={settings} disabled={sending} />
            <ContextPermissions conversation={conversation} state={state} provider={provider} busy={busy || sending || queueAction} />
          </div>
          <div className="queue-send-actions">
            <Button type="button" variant="secondary" size="icon" disabled={sending || reading} aria-label={t('Attach files', 'Adjuntar archivos')} title={t('Attach images or text · maximum 2 MB per file', 'Adjuntar imágenes o texto · máximo 2 MB por archivo')} onClick={() => fileInput.current?.click()}><Paperclip size={17} /></Button>
            {busy && <Button type="button" variant="secondary" size="icon" disabled={queueAction || sending} aria-label={t('Stop response and pause queue', 'Detener respuesta y pausar cola')} onClick={() => void act('stop')}><Square size={15} /></Button>}
            <Button type="submit" size="icon" disabled={!canSend} aria-label={sendLabel} title={sendLabel}><ArrowUp size={19} /></Button>
          </div>
        </div>
        {reading && <p role="status">{t('Preparing attachments…', 'Preparando adjuntos…')}</p>}
      </form>
    </div>
  </div>
}
