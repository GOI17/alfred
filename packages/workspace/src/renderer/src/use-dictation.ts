import { localDictation } from './local-dictation'
import { useLayoutEffect, useRef, useState } from 'react'
import { type DictationEngine, useUI } from './ui-preferences'

type Result = { isFinal: boolean; 0: { transcript: string } }
type Recognizer = {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void; abort(): void
  onresult: ((event: { results: ArrayLike<Result>; resultIndex: number }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type Constructor = new () => Recognizer

export function useDictation(append: (words: string) => void, turnMode?: DictationEngine) {
  const { speechLanguage: language, dictationEngine, setDictationEngine: setMode, t } = useUI()
  const browser = window as Window & { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor }
  const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  const session = useRef<Recognizer | null>(null)
  const mode = turnMode ?? dictationEngine
  const [busy, setBusy] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const [active, setActive] = useState(false)
  const [notice, setNotice] = useState('')
  function release() {
    operation.current?.abort()
    operation.current = null
    recorder.current = null
    const current = session.current
    session.current = null
    if (!current) return
    current.onend = current.onerror = current.onresult = null
    current.abort()
  }
  useLayoutEffect(() => release, [])
  function cancel() { release(); setBusy(false); setActive(false); setNotice('') }
  async function record(engine: 'local' | 'cloud') {
    if (operation.current) return
    const controller = new AbortController()
    const { signal } = controller
    operation.current = controller
    setBusy(true)
    setNotice(t('Waiting for microphone…', 'Esperando al micrófono…'))
    const fail = (message: string) => {
      if (!signal.aborted) { cancel(); setNotice(message) }
    }
    try {
      const mime = ['audio/webm', 'audio/mp4'].find(type => window.MediaRecorder?.isTypeSupported(type))
      if (!mime || !navigator.mediaDevices?.getUserMedia) {
        fail(t('Audio recording is unavailable.', 'La grabación de audio no está disponible.')); return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const close = () => stream.getTracks().forEach(track => track.stop())
      if (signal.aborted) { close(); return }
      signal.addEventListener('abort', close, { once: true })
      const rec = new MediaRecorder(stream, { mimeType: mime })
      recorder.current = rec
      const chunks: Blob[] = []
      let size = 0
      rec.ondataavailable = ({ data }) => {
        if (signal.aborted) return
        size += data.size
        if (size > 8 * 1024 * 1024) fail(t('Recording exceeds 8 MiB. Try a shorter prompt.', 'La grabación supera 8 MiB. Prueba con un dictado más corto.'))
        else chunks.push(data)
      }
      rec.onerror = () => fail(t('Microphone recording failed.', 'Falló la grabación del micrófono.'))
      rec.onstop = async () => {
        close()
        if (signal.aborted) return
        recorder.current = null
        setActive(false); setBusy(true); setNotice(t('Transcribing…', 'Transcribiendo…'))
        try {
          const blob = new Blob(chunks, { type: mime })
          let text: string
          if (engine === 'local') {
            setNotice(t('Preparing Whisper (automatic download on first use)…', 'Preparando Whisper (descarga automática en el primer uso)…'))
            text = await localDictation(blob, language, signal, () => setNotice(t('Transcribing locally…', 'Transcribiendo en este dispositivo…')))
          } else {
            const response = await fetch(`/api/transcription/cloud?language=${language}`, { method: 'POST', body: blob, signal })
            const result = await response.json()
            if (!response.ok || typeof result.text !== 'string') {
              fail(result.error === 'missing_key' ? t('Connect OpenAI in Alfred Settings.', 'Conecta OpenAI en los ajustes de Alfred.')
                : t('Cloud transcription failed. Check your OpenAI connection and quota.', 'Falló la transcripción. Comprueba la conexión y la cuota de OpenAI.')); return
            }
            text = result.text
          }
          if (signal.aborted) return
          cancel()
          if (text.trim()) append(text.trim())
          else setNotice(t('No speech detected.', 'No se detectó voz.'))
        } catch (error) {
          fail(engine === 'local'
            ? `${t('Local Whisper failed', 'Falló Whisper local')}: ${error instanceof Error ? error.message : String(error)}`
            : t('Could not transcribe audio.', 'No se pudo transcribir el audio.'))
        }
      }
      rec.start(1000); setNotice(''); setBusy(false); setActive(true)
    } catch { fail(t('Check microphone access and try again.', 'Comprueba el permiso del micrófono e inténtalo de nuevo.')) }
  }
  function toggle() {
    const unavailable = t('Dictation is unavailable in this browser.', 'El dictado no está disponible en este navegador.')
    try {
      if (mode !== 'browser') {
        if (recorder.current?.state === 'recording') recorder.current.stop()
        else void record(mode)
        return
      }
      if (session.current) { session.current.stop(); return }
      if (!Recognition) { setNotice(unavailable); return }
      const recognition = new Recognition()
      session.current = recognition
      recognition.lang = navigator.languages.find(locale => locale.split('-')[0] === language) ?? (language === 'es' ? 'es-ES' : 'en-US')
      let turn = ''
      recognition.continuous = !turnMode
      recognition.interimResults = false
      recognition.onresult = ({ resultIndex, results }) => {
        const words = Array.from(results).slice(resultIndex).filter(r => r.isFinal).map(r => r[0].transcript.trim()).filter(Boolean).join(' ')
        if (turnMode) turn = [turn, words].filter(Boolean).join(' ')
        else if (words) append(words)
      }
      recognition.onend = () => { session.current = null; setActive(false)
        if (turnMode && turn) append(turn)
        else if (turnMode) setNotice(t('No speech detected.', 'No se detectó voz.'))
      }
      recognition.onerror = ({ error }) => {
        cancel()
        setNotice(error === 'not-allowed' || error === 'service-not-allowed'
          ? t('Allow microphone access to dictate.', 'Permite el acceso al micrófono para dictar.')
          : error === 'no-speech' ? t('No speech detected. Try again.', 'No se detectó voz. Inténtalo de nuevo.')
          : t('Dictation failed. Check your microphone and connection.', 'Falló el dictado. Comprueba el micrófono y la conexión.'))
      }
      setNotice(''); recognition.start(); setActive(true)
    } catch { cancel(); setNotice(unavailable) }
  }
  return { toggle, cancel, active, notice, busy, mode, setMode }
}
