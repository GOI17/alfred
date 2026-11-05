import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react'
import { workspaceCommands } from '../../command-registry'
import { cva, type VariantProps } from 'class-variance-authority'

const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
    size: { default: 'button-default', icon: 'button-icon', small: 'button-small' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
export function Button({
  variant,
  size,
  command,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & VariantProps<typeof variants> & { command?: string | false }) {
  const id = useId()
  const element = useRef<HTMLButtonElement>(null)
  const label = command === false ? undefined : command || props['aria-label'] || props.title || (typeof props.children === 'string' ? props.children : undefined)
  const current = useRef({ label, disabled: props.disabled })
  useLayoutEffect(() => { current.current = { label, disabled: props.disabled } })
  useLayoutEffect(() => workspaceCommands.register(`button-${id}`, {
    available: () => !!current.current.label && !!element.current?.isConnected && !element.current.closest('[role="dialog"]') && !!element.current.getClientRects().length,
    command: () => ({ id: `button-${id}`, label: current.current.label || '', disabled: current.current.disabled || element.current?.getAttribute('aria-disabled') === 'true', run: () => element.current?.click() }),
  }), [id])
  return <button type="button" {...props} ref={element} className={variants({ variant, size })} />
}
