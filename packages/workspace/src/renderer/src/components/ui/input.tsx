import Textfield from '@atlaskit/textfield'
import AtlassianTextarea from '@atlaskit/textarea'
import { Children, isValidElement, useId, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import AtlassianSelect from '@atlaskit/select'

export function Input({ disabled, readOnly, required, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return <Textfield {...props} isDisabled={disabled} isReadOnly={readOnly} isRequired={required}
    isInvalid={props['aria-invalid'] === true || props['aria-invalid'] === 'true'} className="ads-input" />
}
type Option = { value: string; label: string; isDisabled: boolean }
function optionText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('')
}
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children?: ReactNode }>(child)) return []
    if (child.type !== 'option') return optionsFrom(child.props.children)
    const label = optionText(child.props.children)
    return [{ value: String(child.props.value ?? label), label, isDisabled: !!child.props.disabled }]
  })
}
export function Select({ children, value, defaultValue, onValueChange, disabled, required, id, name, ...props }:
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'onChange' | 'value' | 'defaultValue' | 'multiple' | 'onBlur' | 'onFocus' | 'onKeyDown' | 'onKeyUp'> & {
    value?: string; defaultValue?: string; onValueChange?: (value: string) => void
  }) {
  const generatedId = useId()
  const [selected, setSelected] = useState(defaultValue ?? '')
  const options = optionsFrom(children)
  return <AtlassianSelect<Option> inputId={id || generatedId} instanceId={generatedId} name={name}
    className="ads-select" classNamePrefix="ads-select" options={options}
    value={options.find(option => option.value === (value ?? selected)) ?? null}
    onChange={option => { if (option) { setSelected(option.value); onValueChange?.(option.value) } }}
    isDisabled={disabled} required={required} isSearchable={false}
    aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}
    aria-describedby={props['aria-describedby']} aria-invalid={props['aria-invalid']}
    menuPlacement="auto" minMenuHeight={80} maxMenuHeight={240}
  />
}
export function Textarea({ disabled, readOnly, required, spellCheck, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'value' | 'defaultValue'> & { value?: string; defaultValue?: string }) {
  return <AtlassianTextarea {...props} spellCheck={spellCheck === undefined ? undefined : spellCheck === true || spellCheck === 'true'} isDisabled={disabled} isReadOnly={readOnly} isRequired={required}
    isInvalid={props['aria-invalid'] === true || props['aria-invalid'] === 'true'} className="ads-textarea" />
}
