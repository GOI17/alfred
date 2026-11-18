import { Select } from './components/ui/input'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme'
import './assets/ui-preferences.css'

// Serialize async theme loading so a stale preference cannot win a race.
let themeUpdate = Promise.resolve()

type Theme = 'light' | 'dark' | 'system'
type Language = 'es' | 'en'
function read(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Preferences still work for this session. */ } }
export type DictationEngine = 'browser' | 'local' | 'cloud'
type PreferencesValue = { dictationEngine: DictationEngine; setDictationEngine: (value: DictationEngine) => void; replyVoice: string; setReplyVoice: (voice: string) => void; theme: Theme; language: Language; speechLanguage: Language; setSpeechLanguage: (value: Language) => void; setTheme: (value: Theme) => void; setLanguage: (value: Language) => void; t: (en: string, es: string) => string }
const Preferences = createContext<PreferencesValue>({ dictationEngine: 'browser', setDictationEngine: () => {}, replyVoice: 'default', setReplyVoice: () => {}, theme: 'system', language: 'en', speechLanguage: 'en', setSpeechLanguage: () => {}, setTheme: (_value: Theme) => {}, setLanguage: (_value: Language) => {}, t: (en: string, _es: string) => en })
export function UIPreferences({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => { const value = read('alfred.theme'); return value === 'dark' || value === 'light' ? value : 'system' })
  const [language, setLanguage] = useState<Language>(() => { const value = read('alfred.language'); return value === 'es' || value === 'en' ? value : navigator.language.startsWith('es') ? 'es' : 'en' })
  const [dictationEngine, updateEngine] = useState<DictationEngine>(() => {
    const saved = read('alfred.dictationEngine')
    return saved === 'local' || saved === 'cloud' ? saved : 'browser'
  })
  function setDictationEngine(value: DictationEngine) { updateEngine(value); save('alfred.dictationEngine', value) }
  const [spoken, setSpoken] = useState(() => read('alfred.speechLanguage'))
  const [replyVoice, updateReplyVoice] = useState(() => read('alfred.replyVoice') || 'default')
  function setReplyVoice(value: string) { updateReplyVoice(value); save('alfred.replyVoice', value) }
  const speechLanguage = spoken === 'es' || spoken === 'en' ? spoken : language
  function setSpeechLanguage(value: Language) { setSpoken(value); save('alfred.speechLanguage', value) }
  useEffect(() => {
    let disposed = false
    let unbind: (() => void) | undefined
    save('alfred.theme', theme)
    themeUpdate = themeUpdate.then(async () => {
      if (disposed) return
      const cleanup = await setGlobalTheme({ colorMode: theme === 'system' ? 'auto' : theme,
        light: 'light', dark: 'dark', spacing: 'spacing', typography: 'typography', shape: 'shape' })
      if (disposed) cleanup()
      else unbind = cleanup
    }).catch(error => { console.error('Unable to load the interface theme', error) })
    return () => { disposed = true; unbind?.() }
  }, [theme])
  useEffect(() => { document.documentElement.lang = language; save('alfred.language', language) }, [language])
  return <Preferences.Provider value={{ dictationEngine, setDictationEngine, replyVoice, setReplyVoice, theme, language, speechLanguage, setSpeechLanguage, setTheme, setLanguage, t: (en, es) => language === 'es' ? es : en }}>{children}</Preferences.Provider>
}
export const useUI = () => useContext(Preferences)
export function AppearanceSettings() {
  const { theme, language, setTheme, setLanguage, t } = useUI()
  return <div className="appearance-settings">
    <label>{t('Appearance', 'Apariencia')}<Select aria-label={t('Appearance', 'Apariencia')} value={theme} onValueChange={(value) => setTheme(value === 'light' || value === 'dark' ? value : 'system')}>
      <option value="system">{t('System', 'Sistema')}</option><option value="light">{t('Light', 'Claro')}</option><option value="dark">{t('Dark', 'Oscuro')}</option>
    </Select></label>
    <label>{t('Language', 'Idioma')}<Select aria-label={t('Language', 'Idioma')} value={language} onValueChange={(value) => setLanguage(value === 'es' ? 'es' : 'en')}><option value="es">Español</option><option value="en">English</option></Select></label>
    <p className="field-note">{t('Applies to all spaces on this browser. Conversation content is not translated.', 'Se aplica a todos los espacios en este navegador. El contenido de las conversaciones no se traduce.')}</p>
  </div>
}
