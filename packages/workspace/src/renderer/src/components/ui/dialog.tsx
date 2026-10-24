import * as Primitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './button'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className="dialog-content">
          <div className="dialog-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
          <Primitive.Description className="muted">{description}</Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
