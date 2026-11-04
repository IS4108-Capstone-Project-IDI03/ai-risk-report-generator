// A form field in v2's three states (CP-23, board 16 "Fields, three states"):
// normal, Not sure (amber border and tint with a warning icon, no caption,
// AC8) and error (red border, one short line under it, AC19). Wraps the
// design system's Input and Select. Used by the form's cards.
import { useId, type CSSProperties, type ReactNode } from 'react'
import { Icon, Input, Select } from '../../../design-system'
import type { InputProps } from '../../../design-system/components/forms/Input'
import type { SelectProps } from '../../../design-system/components/forms/Select'

type State = { label: string; notSure?: boolean; error?: string; wide?: boolean }

// The control's box: v2's radius 10, amber while Not sure. An error keeps the
// control's own red border (style would override it).
const box = (notSure?: boolean, error?: string): CSSProperties => ({
  borderRadius: 'var(--radius-field)',
  ...(notSure && !error && { border: '1px solid var(--amber-600)', background: 'var(--amber-50)' }),
})

/** Returns the one short line under a field: red alert icon and what to fill in. */
export function ErrorLine({ text }: { text: string }) {
  return (
    <span className="na-error-line">
      <Icon name="circle-alert" size={14} />
      {text}
    </span>
  )
}

// A Not sure field's words for a screen reader, which can't see the amber.
const UNSURE = 'Not sure, check it'
/** Returns the props that point a Not sure control at its hidden words (none otherwise). */
const describedBy = (state: State, id: string) =>
  state.notSure && !state.error ? { 'aria-describedby': id } : {}

// The wrapper the scroll and the amber icon hang from.
function Wrap({
  state,
  kind,
  hintId,
  children,
}: {
  state: State
  kind: string
  hintId: string
  children: ReactNode
}) {
  const unsure = state.notSure && !state.error
  return (
    <div
      className={
        'na-field na-field--' + kind + (state.wide ? ' na-wide' : '') + (unsure ? ' is-unsure' : '')
      }
      data-error={state.error ? '' : undefined}
    >
      {children}
      {unsure && (
        <>
          <span className="na-unsure-icon" role="img" aria-label="Not sure">
            <Icon name="triangle-alert" size={16} />
          </span>
          <span id={hintId} className="na-sr-only">
            {UNSURE}
          </span>
        </>
      )}
    </div>
  )
}

/** Returns a text field with its label, Not sure tint and error line. */
export function TextField({ label, notSure, error, wide, style, ...rest }: State & InputProps) {
  const state = { label, notSure, error, wide }
  const hintId = useId()
  return (
    <Wrap state={state} kind="text" hintId={hintId}>
      <Input
        label={<span className="na-label">{label}</span>}
        error={error && <ErrorLine text={error} />}
        autoComplete="off"
        style={{ ...box(notSure, error), ...style }}
        {...describedBy(state, hintId)}
        {...rest}
      />
    </Wrap>
  )
}

/** Returns a select field; a Not sure one starts on an empty "Choose". */
export function SelectField({
  label,
  notSure,
  error,
  wide,
  options = [],
  ...rest
}: State & SelectProps) {
  const state = { label, notSure, error, wide }
  const hintId = useId()
  return (
    <Wrap state={state} kind="select" hintId={hintId}>
      <Select
        label={<span className="na-label">{label}</span>}
        error={error && <ErrorLine text={error} />}
        options={rest.value ? options : [{ value: '', label: 'Choose' }, ...options]}
        style={box(notSure, error)}
        {...describedBy(state, hintId)}
        {...rest}
      />
    </Wrap>
  )
}
