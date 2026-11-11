import { useEffect, useRef, useState } from 'react'
import { Dialog } from './dialog'
import { Button } from './button'
import { useUI } from '../../ui-preferences'

// A dismissed or abandoned confirmation never authorizes an action.
export function useConfirmation(scope: string) {
  const { t } = useUI()
  const [request, setRequest] = useState<{ message: string; scope: string } | null>(null)
  const pending = useRef<((accepted: boolean) => void) | null>(null)
  const actions = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => () => {
    pending.current?.(false)
    pending.current = null
  }, [scope])

  function finish(accepted: boolean) {
    const resolve = pending.current
    pending.current = null
    setRequest(null)
    resolve?.(accepted)
  }

  function confirm(message: string): Promise<boolean> {
    if (pending.current) return Promise.resolve(false)
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRequest({ message, scope })
    return new Promise(resolve => { pending.current = resolve })
  }

  const dialog = request?.scope === scope ? <Dialog open
    title={t('Confirm action', 'Confirmar acción')} description={request.message}
    onClose={() => finish(false)}
    onOpenAutoFocus={event => {
      event.preventDefault()
      actions.current?.querySelector<HTMLButtonElement>('[data-confirmation-cancel]')?.focus()
    }}
    onCloseAutoFocus={event => {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }}>
    <div ref={actions} className="dialog-actions">
      <Button data-confirmation-cancel variant="secondary" onClick={() => finish(false)}>{t('Cancel', 'Cancelar')}</Button>
      <Button onClick={() => finish(true)}>{t('Confirm', 'Confirmar')}</Button>
    </div>
  </Dialog> : null
  return { confirm, dialog }
}
