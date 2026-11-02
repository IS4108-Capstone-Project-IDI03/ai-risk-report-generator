// A text field that suggests names already used (CP-16, CP-22): our own
// list under the field instead of the browser's datalist, so it looks like
// the rest of the app. Used by LocationSheet.tsx's LocationForm.
import { useState, type ChangeEvent } from 'react'
import { Input } from '../../../design-system'
import type { InputProps } from '../../../design-system/components/forms/Input'
import '../observations.css'

type Props = Omit<InputProps, 'value' | 'onChange'> & {
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  suggestions: string[]
}

// Returns the field and, while it has focus, up to six matching names.
export function SuggestField({ value, onChange, suggestions, ...input }: Props) {
  const [focused, setFocused] = useState(false)
  const typed = value.trim().toLowerCase()
  const matches = suggestions
    .filter((name) => name.toLowerCase().includes(typed) && name.toLowerCase() !== typed)
    .slice(0, 6)
  // Fills the field as typing would, so the form's checks run the same way.
  const choose = (name: string) =>
    onChange({ target: { value: name } } as ChangeEvent<HTMLInputElement>)
  return (
    // Focus is watched here: the field keeps its own focus handlers.
    <div
      style={{ position: 'relative' }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <Input {...input} value={value} onChange={onChange} autoComplete="off" />
      {focused && matches.length > 0 && (
        <ul className="ob-suggest-list" aria-label="Suggestions">
          {matches.map((name) => (
            <li key={name}>
              {/* mousedown, not click: the field's blur would close the list first. */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(name)
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
