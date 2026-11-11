import { useEffect, useRef, useState } from 'react'
import { Dialog } from './components/ui/dialog'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

type Request = { message: string; kind: 'confirm' | 'prompt'; alternative?: string }
type Answer = string | boolean | null

// Closing, replacing the repository, or unmounting never authorizes an action.
export function useGitDialog() {
  const { t } = useUI()
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')
  const pending = useRef<((answer: Answer) => void) | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLDivElement>(null)
  useEffect(() => () => {
    pending.current?.(null)
    pending.current = null
  }, [])

  function finish(answer: Answer) {
    const resolve = pending.current
    pending.current = null
    setRequest(null)
    resolve?.(answer)
  }
  function ask(next: Request, initial = ''): Promise<Answer> {
    if (pending.current) return Promise.resolve(null)
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setValue(initial)
    setRequest(next)
    return new Promise(resolve => { pending.current = resolve })
  }
  const confirm = async (message: string, alternative?: string): Promise<boolean | null> => {
    const result = await ask({ kind: 'confirm', message, alternative })
    return typeof result === 'boolean' ? result : null
  }
  const prompt = async (message: string, initial = ''): Promise<string | null> => {
    const result = await ask({ kind: 'prompt', message }, initial)
    return typeof result === 'string' ? result : null
  }
  const dialog = request && <Dialog open title={request.kind === 'prompt' ? t('Git input', 'Datos de Git') : t('Confirm action', 'Confirmar acción')}
    description={request.message} onClose={() => finish(null)}
    onOpenAutoFocus={event => {
      event.preventDefault()
      if (request.kind === 'prompt') { input.current?.focus(); input.current?.select() }
      else cancel.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    }}
    onCloseAutoFocus={event => {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (request.kind === 'prompt' && !value.trim()) return
      finish(request.kind === 'prompt' ? value.trim() : true)
    }}>
      {request.kind === 'prompt' && <input ref={input} className="input" aria-label={request.message}
        value={value} maxLength={10000} onChange={event => setValue(event.target.value)} />}
      <div ref={cancel} className="dialog-actions">
        <Button data-cancel type="button" variant="secondary" onClick={() => finish(null)}>{t('Cancel', 'Cancelar')}</Button>
        {request.alternative && <Button type="button" variant="secondary" onClick={() => finish(false)}>{request.alternative}</Button>}
        <Button type="submit" disabled={request.kind === 'prompt' && !value.trim()}>{t('Confirm', 'Confirmar')}</Button>
      </div>
    </form>
  </Dialog>
  return { confirm, prompt, dialog }
}
