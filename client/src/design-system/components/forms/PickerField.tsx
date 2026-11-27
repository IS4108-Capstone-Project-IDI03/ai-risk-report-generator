// Picker field (CP-24, v2 NEW pattern): a v2 field (40 px, radius 10) whose value shows its own
// icon (category tile, severity symbol, map pin) and opens a list, with the AI suggestion states a
// plain Select has no need for (v2 section 2). States, quietest to loudest: filled,
// suggesting (blue, waiting words), not sure (amber, warning icon), failed (red, alert icon), or a
// plain error (red border, one line). A not-sure field's Confirm and Change are two shaded icon
// actions on its label line. The list comes in through `list` (ChoicePickerField.tsx fills it with
// ChoiceMenu).
// Called by the observation page and New Observation. Calls Icon, IconAction, ReadingStatus, useSwap.
import { useId, type ReactElement, type ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { IconAction } from '../core/IconAction'
import { ReadingStatus } from '../feedback/ReadingStatus'
import { useSwap } from '../display/useSwap'

// What the list receives: where to draw its anchor, and the button/label line it wraps.
export type PickerListSlot = {
  // Makes the anchor as wide as the field (see .cpf-menu).
  className: string
  trigger: (open: boolean, toggle: () => void) => ReactElement
}

export type PickerFieldProps = {
  label: string
  required?: boolean
  // The value with its icon; nothing shows `placeholder` in grey.
  value?: ReactNode
  // The value in words, for the button's accessible name.
  valueLabel?: string
  placeholder?: string
  // While the value is being suggested: the waiting words in place of a value (blue field).
  suggesting?: string
  // The value is a suggestion the AI was not sure of (amber).
  notSure?: boolean
  // The suggestion failed (red, louder than not sure). The line saying why sits under the fields.
  failed?: boolean
  error?: string
  // A grey line under the field, as an Input's hint (hidden while there is an error).
  description?: ReactNode
  // A (?) beside the label.
  help?: ReactNode
  // View only: marks still show, but the field opens no list and has no Confirm or Change.
  disabled?: boolean
  // Confirm and Change on the label line of a not-sure field; Confirm shows only with onConfirm.
  confirmLabel?: string
  changeLabel?: string
  onConfirm?: () => void
  // The list the field opens, as a function of its slot; without it the field draws closed only.
  list?: (slot: PickerListSlot) => ReactElement
  // Boards only: draws the field as hovered, since a canvas has no pointer.
  hovered?: boolean
}

const noop = () => {}

// The aria state the list's popover injects into its trigger (aria-haspopup, -expanded, -controls).
type Aria = Record<string, unknown>

// The trigger the list clones: it hands the injected aria state to the field's button, since the
// label line is several elements and only the button is the control. A top-level component, so the
// field is never remounted as its state changes.
function PickerTrigger({ render, ...aria }: { render: (aria: Aria) => ReactElement } & Aria) {
  return render(aria)
}

/** Returns the labelled field: label line (with Confirm and Change when not sure), value or waiting words, its list and its error line. */
export function PickerField({
  label,
  required,
  value,
  valueLabel,
  placeholder,
  suggesting,
  notSure,
  failed,
  error,
  description,
  help,
  disabled,
  confirmLabel = `Confirm ${label.toLowerCase()}`,
  changeLabel = `Change ${label.toLowerCase()}`,
  onConfirm,
  list,
  hovered,
}: PickerFieldProps) {
  const bad = failed || !!error
  // Ties the label word to the field's button, so pressing the word opens the list. Only the word
  // is the label: the (?) help and Confirm / Change are buttons and must not be part of it.
  const buttonId = useId()
  const unsure = !!notSure && !bad && !suggesting
  // Motion 1 and 3: the waiting words fade out over 100 ms as the value rises in; the warning
  // icon and the two actions fade out over 120 ms once the value is confirmed.
  const waiting = useSwap(suggesting ?? null, 100)
  const mark = useSwap(unsure, 120)
  const markOut = mark.was === true && !unsure
  const showUnsure = unsure || markOut
  const arrived = waiting.moved && !suggesting
  const actions = !disabled && !!onConfirm && showUnsure
  const name =
    `${label}: ${valueLabel ?? placeholder ?? ''}` +
    (unsure ? '. Not sure, check it' : '') +
    (failed ? '. Suggestion failed' : '') +
    (disabled || suggesting ? '' : '. Change')

  const field = (toggle: () => void, aria: Aria = {}) => (
    <button
      {...aria}
      id={buttonId}
      type="button"
      className="cpf-button"
      aria-label={suggesting ? `${label}: ${suggesting}` : name}
      aria-invalid={bad || undefined}
      aria-busy={!!suggesting || undefined}
      aria-disabled={disabled || !!suggesting || undefined}
      onClick={disabled || suggesting ? undefined : toggle}
    >
      <span className="cpf-value">
        {suggesting ? (
          <ReadingStatus state="working" label={suggesting} />
        ) : (
          <>
            {waiting.was !== null && (
              <span className="cpf-was" data-out aria-hidden="true">
                {waiting.was}
              </span>
            )}
            <span key={waiting.turn} className="cpf-now" data-in={arrived || undefined}>
              {value ?? <span className="cpf-text">{placeholder}</span>}
            </span>
          </>
        )}
      </span>
      {showUnsure && (
        <span
          className="cpf-mark cpf-mark--unsure"
          data-in={mark.moved && unsure ? '' : undefined}
          data-out={markOut ? '' : undefined}
          role={unsure ? 'img' : undefined}
          aria-label={unsure ? 'Not sure, check it' : undefined}
          aria-hidden={unsure ? undefined : true}
        >
          <Icon name="triangle-alert" size={16} />
        </span>
      )}
      {failed && (
        <span className="cpf-mark cpf-mark--failed" role="img" aria-label="Suggestion failed">
          <Icon name="circle-alert" size={16} />
        </span>
      )}
      {!suggesting && !disabled && (
        <span className="cpf-chev">
          <Icon name="chevron-down" size={14} color="var(--text-muted)" />
        </span>
      )}
    </button>
  )

  const labelLine = (toggle: () => void, aria?: Aria) => (
    <>
      <span className="cpf-label">
        <span className="cpf-label-text">
          <label htmlFor={buttonId}>{label}</label>
          {required && (
            <>
              <span aria-hidden="true" className="cpf-required">
                {'*'}
              </span>
              <span className="ds-sr-only">{' (required)'}</span>
            </>
          )}
          {help}
        </span>
        {actions && (
          <span className="cpf-decide" data-out={markOut ? '' : undefined}>
            <span className="cpf-confirm">
              <IconAction
                icon="check"
                label={confirmLabel}
                tooltip={confirmLabel}
                size="sm"
                shaded
                onClick={onConfirm}
              />
            </span>
            <IconAction
              icon="arrow-left-right"
              label={changeLabel}
              tooltip={changeLabel}
              size="sm"
              shaded
              onClick={toggle}
            />
          </span>
        )}
      </span>
      {field(toggle, aria)}
    </>
  )

  return (
    <div
      className="cpf"
      data-hover={hovered || undefined}
      data-unsure={unsure || undefined}
      data-failed={bad || undefined}
      data-waiting={suggesting ? '' : undefined}
      data-empty={!value && !suggesting ? '' : undefined}
      data-readonly={disabled || undefined}
    >
      {/* Always wrapped when there is a list, so the field is never remounted as its state changes. */}
      {list
        ? list({
            className: 'cpf-menu',
            trigger: (_open, toggle) => (
              <PickerTrigger render={(aria) => <>{labelLine(toggle, aria)}</>} />
            ),
          })
        : labelLine(noop)}
      {error ? (
        <span className="cpf-error" role="alert">
          <Icon name="circle-alert" size={14} />
          {error}
        </span>
      ) : (
        description && <span className="cpf-hint">{description}</span>
      )}
    </div>
  )
}
