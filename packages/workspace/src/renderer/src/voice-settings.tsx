import { useEffect, useId, useRef, useState } from 'react'
import { playSpeech } from './reply-speech'
import { Play, SlidersHorizontal, Square } from 'lucide-react'
import { Button } from './components/ui/button'
import { Dialog } from './components/ui/dialog'
import { Select } from './components/ui/input'
import { useUI } from './ui-preferences'

type Engine = 'browser' | 'local' | 'cloud'
export function VoiceSettings({ mode, disabled, onChange, labeled }: { labeled?: boolean; mode: Engine; disabled: boolean; onChange: (engine: Engine) => void }) {
  const { t, speechLanguage, setSpeechLanguage } = useUI()
  const [open, setOpen] = useState(false)
  const id = useId()
  const title = t('Voice settings', 'Ajustes de voz')
  return <>
    <Button variant="ghost" size={labeled ? "action-row" : "icon"} aria-label={title} title={title} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)}><SlidersHorizontal size={16} />{labeled && title}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={title} description={t('These settings apply to dictation and /voice.', 'Estos ajustes se aplican al dictado y a /voice.')}>
      <div className="voice-settings-fields">
        <div>
          <label htmlFor={`${id}-language`}>{t('Spoken language', 'Idioma de voz')}</label>
          <Select menuPosition="fixed" id={`${id}-language`} value={speechLanguage} disabled={disabled} onValueChange={value => { if (value === 'en' || value === 'es') setSpeechLanguage(value) }}>
            <option value="es">Español</option><option value="en">English</option>
          </Select>
        </div>
        <div>
          <label htmlFor={`${id}-engine`}>{t('Dictation engine', 'Motor de dictado')}</label>
          <Select menuPosition="fixed" id={`${id}-engine`} value={mode} disabled={disabled} onValueChange={value => { if (value === 'browser' || value === 'local' || value === 'cloud') onChange(value) }}>
            <option value="browser">{t('Browser', 'Navegador')}</option><option value="local">Whisper local</option><option value="cloud">{t('Send audio to OpenAI', 'Enviar audio a OpenAI')}</option>
          </Select>
        </div>
        {open && <ReplyVoiceSettings />}
      </div>
    </Dialog>
  </>
}

function ReplyVoiceSettings() {
  const { t, speechLanguage, replyVoice, setReplyVoice } = useUI()
  const id = useId()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const update = () => setVoices(synth.getVoices().filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === speechLanguage))
    update(); synth.addEventListener('voiceschanged', update)
    return () => synth.removeEventListener('voiceschanged', update)
  }, [speechLanguage])
  useEffect(() => {
    setPlaying(false); setError('')
    return () => { stop.current?.(); stop.current = null }
  }, [speechLanguage, replyVoice])
  const selected = replyVoice.startsWith('device:') && !voices.some(v => `device:${v.voiceURI}` === replyVoice) ? 'default' : replyVoice
  function preview() {
    if (playing) { stop.current?.(); setPlaying(false); return }
    setPlaying(true); setError('')
    stop.current = playSpeech(speechLanguage === 'es' ? 'Hola, soy Alfred. Así sonarán mis respuestas.' : 'Hi, I’m Alfred. This is how my replies will sound.', speechLanguage, selected,
      () => setPlaying(false), missingKey => { setPlaying(false); setError(missingKey ? t('Connect OpenAI in Settings.', 'Conecta OpenAI en Ajustes.') : t('Could not play the sample.', 'No se pudo reproducir la muestra.')) })
  }
  return <div>
    <label htmlFor={id}>{t('Reply voice', 'Voz de respuesta')}</label>
    <Select menuPosition="fixed" id={id} value={selected} onValueChange={setReplyVoice}>
      <option value="default">{t('Browser default', 'Predeterminada del navegador')}</option>
      {voices.map(v => <option key={v.voiceURI} value={`device:${v.voiceURI}`}>{v.name} ({v.lang})</option>)}
      <option value="openai:marin">OpenAI · Marin</option><option value="openai:cedar">OpenAI · Cedar</option>
    </Select>
    {selected.startsWith('openai:') && <p className="field-note">{t('AI-generated voice. Samples and spoken replies send text to OpenAI and incur usage charges.', 'Voz generada por IA. Las muestras y las respuestas habladas envían texto a OpenAI y consumen cuota.')}</p>}
    <div className="voice-preview-action"><Button type="button" variant="ghost" onClick={preview}>
      {playing ? <Square size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      {playing ? t('Stop sample', 'Detener muestra') : t('Play sample', 'Escuchar muestra')}
    </Button></div>
    {error && <p role="status">{error}</p>}
  </div>
}
