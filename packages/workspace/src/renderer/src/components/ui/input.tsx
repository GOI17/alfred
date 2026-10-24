import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Input(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return <input {...props} className="input" />
}
export function Select(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return <select {...props} className="input" />
}
export function Textarea(props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return <textarea {...props} className="textarea" />
}
