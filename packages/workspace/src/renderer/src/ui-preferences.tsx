import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import './assets/ui-preferences.css'

type Theme = 'light' | 'dark' | 'system'
type Language = 'es' | 'en'
function read(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Preferences still work for this session. */ } }
const Preferences = createContext({ theme: 'system' as Theme, language: 'en' as Language, setTheme: (_value: Theme) => {}, setLanguage: (_value: Language) => {}, t: (en: string, _es: string) => en })
export function UIPreferences({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => { const value = read('alfred.theme'); return value === 'dark' || value === 'light' ? value : 'system' })
  const [language, setLanguage] = useState<Language>(() => { const value = read('alfred.language'); return value === 'es' || value === 'en' ? value : navigator.language.startsWith('es') ? 'es' : 'en' })
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? query.matches ? 'dark' : 'light' : theme }
    apply(); save('alfred.theme', theme)
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => { document.documentElement.lang = language; save('alfred.language', language) }, [language])
  return <Preferences.Provider value={{ theme, language, setTheme, setLanguage, t: (en, es) => language === 'es' ? es : en }}>{children}</Preferences.Provider>
}
export const useUI = () => useContext(Preferences)
export function AppearanceSettings() {
  const { theme, language, setTheme, setLanguage, t } = useUI()
  return <div className="appearance-settings">
    <label>{t('Appearance', 'Apariencia')}<select className="input" aria-label={t('Appearance', 'Apariencia')} value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
      <option value="system">{t('System', 'Sistema')}</option><option value="light">{t('Light', 'Claro')}</option><option value="dark">{t('Dark', 'Oscuro')}</option>
    </select></label>
    <label>{t('Language', 'Idioma')}<select className="input" aria-label={t('Language', 'Idioma')} value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="es">Español</option><option value="en">English</option></select></label>
    <p className="field-note">{t('Applies to all spaces on this browser. Conversation content is not translated.', 'Se aplica a todos los espacios en este navegador. El contenido de las conversaciones no se traduce.')}</p>
  </div>
}
