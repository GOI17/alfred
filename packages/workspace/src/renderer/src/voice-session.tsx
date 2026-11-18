import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { playSpeech } from './reply-speech'
import { Mic } from 'lucide-react'
import { Button } from './components/ui/button'
import './assets/voice-session.css'
import type { AgentState, Conversation, ProviderId } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { useDictation } from './use-dictation'
import { useUI } from './ui-preferences'

type Props = { conversation: Conversation; provider: ProviderId; agent?: AgentState; engine: 'browser' | 'local' | 'cloud'; onClose(): void }
export function VoiceSession({ conversation, provider, agent, engine, onClose }: Props) {
  const { speechLanguage: language, replyVoice, t } = useUI()
  const [phase, setPhase] = useState<'listen' | 'wait' | 'speak' | 'paused'>('listen')
  const [error, setError] = useState('')
  const alive = useRef(false)
  const turn = useRef<{ previous: Set<string>; words: string } | null>(null)
  const playback = useRef<(() => void) | null>(null)
  const dictation = useDictation(async words => {
    if (!alive.current || turn.current) return
    turn.current = { previous: new Set(conversation.messages.map(m => m.id)), words }
    setPhase('wait')
    try { await api(`/conversations/${conversation.id}/messages`, { text: words, provider, mode: 'queue' }) }
    catch (err) { if (alive.current) { setError(errorMessage(err)); setPhase('paused') } }
  }, engine)
  const toggle = useRef(dictation.toggle)
  useLayoutEffect(() => { toggle.current = dictation.toggle })
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      playback.current?.()
    }
  }, [])
  useEffect(() => {
    if (phase !== 'listen') return
    const timer = window.setTimeout(() => toggle.current(), 0)
    return () => clearTimeout(timer)
  }, [phase])
  useEffect(() => {
    if (phase !== 'wait' || !turn.current || agent?.status === 'running' || agent?.status === 'waiting') return
    if (agent?.status === 'error') { setPhase('paused'); return }
    const { previous, words } = turn.current
    const index = conversation.messages.findIndex(m => !previous.has(m.id) && m.role === 'user' && m.text === words)
    const reply = conversation.messages[index + 1]
    if (index < 0 || reply?.role !== 'assistant') return
    const text = reply.segments?.filter(s => s.kind === 'result').map(s => s.text).join('\n') || reply.text
    if (!text.trim()) return
    turn.current = null
    setPhase('speak')
    playback.current = playSpeech(text, language, replyVoice,
      () => { if (alive.current) setPhase('listen') },
      missingKey => { if (alive.current) { setPhase('paused'); setError(missingKey ? t('Connect OpenAI in Settings.', 'Conecta OpenAI en Ajustes.') : t('Could not play the reply.', 'No se pudo reproducir la respuesta.')) } })
  }, [phase, conversation.messages, agent?.status, language, replyVoice, t])
  return <section className="voice-session" aria-label={t('Voice conversation', 'Conversación hablada')}>
    <div>
      <strong className="voice-session-title"><Mic size={16} aria-hidden="true" />{t('Voice conversation', 'Conversación hablada')}</strong>
      <p role="status">{error || (phase === 'listen' ? dictation.notice || t('Listening… Your turn will be sent to the chat.', 'Escuchando… Tu turno se enviará al chat.') : phase === 'wait' ? t('Waiting for Alfred…', 'Esperando a Alfred…') : phase === 'speak' ? t('Alfred is speaking…', 'Alfred está hablando…') : t('Session paused.', 'Sesión en pausa.'))}</p>
    </div>
    <div className="voice-session-actions">
      {phase === 'listen' && !dictation.busy && <Button type="button" onClick={dictation.toggle}>{dictation.active ? t('Finish turn', 'Terminar turno') : t('Speak', 'Hablar')}</Button>}
      <Button type="button" variant="ghost" onClick={onClose}>{t('End voice conversation', 'Salir de /voice')}</Button>
    </div>
  </section>
}
