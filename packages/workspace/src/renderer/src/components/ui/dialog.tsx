import ModalDialog, { ModalBody, ModalHeader, useModal } from '@atlaskit/modal-dialog'
import { useCallback, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useUI } from '../../ui-preferences'
import { X } from 'lucide-react'
import { Button } from './button'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}
function Heading({ title, heading, onClose }: { title: string; heading: RefObject<HTMLHeadingElement | null>; onClose: () => void }) {
  const { titleId } = useModal()
  const { t } = useUI()
  return <ModalHeader><div className="dialog-heading ads-dialog-heading">
    <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
    <Button variant="ghost" size="icon" aria-label={t('Close', 'Cerrar')} onClick={onClose}><X size={18} /></Button>
  </div></ModalHeader>
}
function OpenDialog({ onClose, title, description, children, onOpenAutoFocus, onCloseAutoFocus }: Omit<Props, 'open'>) {
  const heading = useRef<HTMLHeadingElement>(null)
  const descriptionId = useId()
  const callbacks = useRef({ onOpenAutoFocus, onCloseAutoFocus })
  useLayoutEffect(() => { callbacks.current = { onOpenAutoFocus, onCloseAutoFocus } })
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      // Focus lock is removed before restoring focus, including nested confirmations.
      queueMicrotask(() => {
        const event = new Event('closeAutoFocus', { cancelable: true })
        callbacks.current.onCloseAutoFocus?.(event)
        if (!event.defaultPrevented && opener?.isConnected) opener.focus({ preventScroll: true })
      })
    }
  }, [])
  const modalRef = useCallback((node: HTMLElement | null) => {
    if (description) node?.setAttribute('aria-describedby', descriptionId)
    else node?.removeAttribute('aria-describedby')
  }, [description, descriptionId])
  return <ModalDialog ref={modalRef} onClose={onClose} autoFocus={heading} shouldReturnFocus={false} width="medium"
    onOpenComplete={() => {
      // The entrance animation must not steal focus after the user has already interacted.
      if (document.activeElement !== heading.current) return
      const event = new Event('openAutoFocus', { cancelable: true })
      callbacks.current.onOpenAutoFocus?.(event)
      if (!event.defaultPrevented) heading.current?.focus({ preventScroll: true })
    }}>
    <Heading title={title} heading={heading} onClose={onClose} />
    <ModalBody><div className="ads-dialog-body">
      {description && <p id={descriptionId} className="muted" style={{ whiteSpace: 'pre-line' }}>{description}</p>}
      {children}
    </div></ModalBody>
  </ModalDialog>
}
export function Dialog({ open, ...props }: Props) {
  return open ? <OpenDialog {...props} /> : null
}
