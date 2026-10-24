import type { ButtonHTMLAttributes } from 'react'
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
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & VariantProps<typeof variants>) {
  return <button type="button" {...props} className={variants({ variant, size })} />
}
