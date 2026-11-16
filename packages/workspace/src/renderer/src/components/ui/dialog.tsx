import * as Primitive from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'
import { useUI } from '../../ui-preferences'
import { X } from 'lucide-react'
import { Button } from './button'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const { t } = useUI()
  const opener = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className="dialog-content" onOpenAutoFocus={event => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          onOpenAutoFocus?.(event)
          if (!event.defaultPrevented) {
            event.preventDefault()
            heading.current?.focus({ preventScroll: true })
          }
        }} onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event)
          if (!event.defaultPrevented && opener.current?.isConnected) {
            event.preventDefault()
            opener.current.focus({ preventScroll: true })
          }
        }}>
          <div className="dialog-heading">
            <Primitive.Title ref={heading} tabIndex={-1}>{title}</Primitive.Title>
            <Button variant="ghost" size="icon" aria-label={t('Close', 'Cerrar')} onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
          <Primitive.Description className="muted" style={{ whiteSpace: 'pre-line' }}>{description}</Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
