import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react'
import { workspaceCommands } from '../../command-registry'
import AtlassianButton from '@atlaskit/button/new'

type Variant = 'default' | 'secondary' | 'ghost' | 'danger'
type Size = 'default' | 'icon' | 'small' | 'action-row'
const appearances = { default: 'primary', secondary: 'default', ghost: 'subtle', danger: 'danger' } as const

export function Button({
  variant = 'default',
  size = 'default',
  disabled,
  children,
  command,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { variant?: Variant; size?: Size; command?: string | false }) {
  const id = useId()
  const element = useRef<HTMLButtonElement>(null)
  const label = command === false ? undefined : command || props['aria-label'] || props.title || (typeof children === 'string' ? children : undefined)
  const current = useRef({ label, disabled: disabled })
  useLayoutEffect(() => { current.current = { label, disabled: disabled } })
  useLayoutEffect(() => workspaceCommands.register(`button-${id}`, {
    available: () => !!current.current.label && !!element.current?.isConnected && !element.current.closest('[role="dialog"]') && !!element.current.getClientRects().length,
    command: () => ({ id: `button-${id}`, label: current.current.label || '', disabled: current.current.disabled || element.current?.getAttribute('aria-disabled') === 'true', run: () => element.current?.click() }),
  }), [id])
  return <AtlassianButton type="button" {...props} ref={element} isDisabled={disabled}
    appearance={appearances[variant]} spacing={size === 'small' ? 'compact' : 'default'}
    data-alfred-button={size}><span className="alfred-button-content">{children}</span></AtlassianButton>
}
