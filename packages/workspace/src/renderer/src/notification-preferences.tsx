import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'

const promptKey = 'alfred.notifications.prompted'
let promptedThisSession = false
function wasPrompted() {
  try { return promptedThisSession || localStorage.getItem(promptKey) === 'true' }
  catch { return promptedThisSession }
}
function rememberPrompt() {
  promptedThisSession = true
  try { localStorage.setItem(promptKey, 'true') } catch { /* Remember for this session when storage is unavailable. */ }
}
function supported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
async function registration() {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}
type Notifications = {
  available: boolean; checked: boolean; enabled: boolean; busy: boolean; error: string
  change: (enabled: boolean) => Promise<boolean>
}
const Preferences = createContext<Notifications | null>(null)

/** Mounted only after authentication, shared by onboarding and Settings. */
export function NotificationPreferences({ children }: { children: ReactNode }) {
  const { t } = useUI()
  const available = supported()
  const [checked, setChecked] = useState(!available)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState(false)
  useEffect(() => {
    if (!available) return
    let alive = true
    void registration().then(async (worker) => {
      const subscription = await worker.pushManager.getSubscription()
      if (!alive) return
      const active = !!subscription && Notification.permission === 'granted'
      setEnabled(active)
      if (active) {
        rememberPrompt()
        // Restore delivery after a server restart, without requesting permission.
        await api('/notifications', subscription.toJSON())
      } else if (!wasPrompted()) {
        rememberPrompt()
        setInvite(true)
      }
    }).catch((error) => { if (alive) setError(errorMessage(error)) })
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [available])

  async function change(next: boolean) {
    if (!available || !checked || busy) return false
    rememberPrompt()
    setError(''); setBusy(true)
    try {
      if (next) {
        // Keep the permission request in the click handler's user gesture (iOS).
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') throw new Error(t('Allow notifications in your browser settings.', 'Permite las notificaciones en los ajustes del navegador.'))
      }
      const worker = await registration()
      let subscription = await worker.pushManager.getSubscription()
      if (next) {
        const { publicKey } = await api<{ publicKey: string }>('/notifications')
        const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
        subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        await api('/notifications', subscription.toJSON())
      } else if (subscription) {
        await api('/notifications', { endpoint: subscription.endpoint }, 'DELETE')
        await subscription.unsubscribe()
      }
      setEnabled(next)
      return true
    } catch (error) { setError(errorMessage(error)); return false }
    finally { setBusy(false) }
  }

  return <Preferences.Provider value={{ available, checked, enabled, busy, error, change }}>
    {children}
    {invite && <Dialog open onClose={() => setInvite(false)} title={t('Enable notifications?', '¿Activar notificaciones?')}
      description={t('Get notified when Alfred finishes, needs approval, or encounters an error. Notifications contain no chat content.', 'Recibe un aviso cuando Alfred termine, necesite aprobación o encuentre un error. Las notificaciones no incluyen contenido del chat.')}>
      <p className="field-note">{t('You can change this later in Settings → Interface.', 'Puedes cambiarlo después en Ajustes → Interfaz.')}</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={() => setInvite(false)}>{t('Not now', 'Ahora no')}</Button>
        <Button disabled={!checked || busy} onClick={() => void change(true).then((saved) => { if (saved) setInvite(false) })}>{busy ? t('Saving…', 'Guardando…') : t('Enable notifications', 'Activar notificaciones')}</Button>
      </div>
    </Dialog>}
  </Preferences.Provider>
}

export function NotificationSettings() {
  const { t } = useUI()
  const preferences = useContext(Preferences)
  if (!preferences) return null
  const { available, checked, enabled, busy, error, change } = preferences
  return <section className="notification-settings" aria-labelledby="settings-notifications-title">
    <h3 id="settings-notifications-title">{t('Notifications', 'Notificaciones')}</h3>
    <p>{t('Receive completion, error and approval alerts on this device, even with Alfred closed. Notifications contain no chat content.', 'Recibe avisos de finalización, errores y solicitudes de aprobación en este dispositivo, incluso con Alfred cerrado. Las notificaciones no incluyen contenido del chat.')}</p>
    {!available && <p className="field-note">{t('Requires HTTPS and a browser with Web Push. On iPhone/iPad (16.4+), add Alfred to your Home Screen and open it there.', 'Requiere HTTPS y un navegador con Web Push. En iPhone/iPad (16.4+), añade Alfred a la pantalla de inicio y ábrelo desde allí.')}</p>}
    <Button disabled={!available || !checked || busy} onClick={() => void change(!enabled)}>{busy ? t('Saving…', 'Guardando…') : enabled ? t('Disable notifications', 'Desactivar notificaciones') : t('Enable notifications', 'Activar notificaciones')}</Button>
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>
}
