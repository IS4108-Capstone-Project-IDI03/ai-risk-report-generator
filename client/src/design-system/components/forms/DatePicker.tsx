// Date picker (CP-23, board 19): dd/mm/yyyy text field + calendar button; a click anywhere on
// the field opens the calendar (round 13): popover on desktop, centred card on phones (Popover
// does that). Typing adds the slashes. Value is an ISO yyyy-mm-dd string, like the
// New Assessment form stores. Called by forms (survey start/end, report due). Calls Popover, Input.
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../core/Icon'
import { IconButton } from '../core/IconButton'
import { Popover } from '../feedback/Popover'
import { useIsPhone } from '../feedback/Sheet'

export type DatePickerProps = {
  label?: string
  // ISO yyyy-mm-dd, or '' for no date.
  value: string
  // Fired on a pick, a typed date, Today or Clear. beforeMin is true when value < min; invalid is
  // true (with value '') while typed text is not yet a real dd/mm/yyyy date.
  onChange: (value: string, info: { beforeMin: boolean; invalid?: boolean }) => void
  // ISO. Earlier days are greyed out and cannot be picked; a typed one is still reported.
  min?: string
  // Message under the field (the form owns the wording).
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  name?: string
  // Id of another element that describes the field (joined with the hint/error line's id).
  describedBy?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromIso = (iso: string) => new Date(iso + 'T00:00:00')
const show = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '')
const MONTHS =
  'January February March April May June July August September October November December'.split(' ')

/** Returns the ISO day for "d/m/yyyy" text, or null when it is not a real date. */
export function parseTyped(text: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim())
  if (!m) return null
  const d = new Date(+m[3], +m[2] - 1, +m[1])
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? toIso(d) : null
}

/** Returns typed text as dd/mm/yyyy so far: digits only, slashes added; "1/" pads to "01/". */
function maskTyped(raw: string): string {
  const parts = raw.split(/[/.-]/)
  const digits = parts
    .map((p, i) => {
      const d = p.replace(/\D/g, '')
      // A day or month closed early with a separator gets its leading zero.
      return i < 2 && i < parts.length - 1 && d.length === 1 ? '0' + d : d
    })
    .join('')
    .slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/')
}

/** Returns a calendar for the month of `focus`; Monday first, six weeks, days before min disabled. */
function Calendar({
  value,
  min,
  onPick,
  onClear,
  focusDay,
}: {
  value: string
  min?: string
  onPick: (iso: string) => void
  onClear: () => void
  // False when opened by a click on the text: focus stays there so typing still works.
  focusDay: boolean
}) {
  const today = toIso(new Date())
  const [focus, setFocus] = useState(value || (min && min > today ? min : today))
  const grid = useRef<HTMLDivElement>(null)
  const f = fromIso(focus)
  const start = new Date(f.getFullYear(), f.getMonth(), 1)
  start.setDate(1 - ((start.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  // The grid only animates once the month has changed, so opening is calm.
  const [animate, setAnimate] = useState<'next' | 'prev' | undefined>()
  // Only the month arrows animate: a keyboard move into the next month changes it at once,
  // since motion on keyboard steps makes them feel slow.
  const move = (days: number, months = 0) => {
    let d = new Date(f.getFullYear(), f.getMonth() + months, f.getDate() + days)
    // Never move before min: those days cannot be picked.
    if (min && toIso(d) < min) d = fromIso(min)
    setAnimate(months === 0 ? undefined : months > 0 ? 'next' : 'prev')
    setFocus(toIso(d))
  }
  // After a keyboard move the new day takes focus.
  const moved = useRef(false)
  // Opening from the calendar button puts focus on the day, so the keyboard works at once.
  useEffect(() => {
    if (focusDay) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [focusDay])
  useEffect(() => {
    if (moved.current) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [focus])
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    moved.current = true
    move(step)
  }
  return (
    <div className="ds-cal">
      <div className="ds-cal-head">
        <strong aria-live="polite">
          {MONTHS[f.getMonth()]} {f.getFullYear()}
        </strong>
        <IconButton icon="chevron-left" label="Previous month" onClick={() => move(0, -1)} />
        <IconButton icon="chevron-right" label="Next month" onClick={() => move(0, 1)} />
      </div>
      <div
        className="ds-cal-grid"
        role="group"
        aria-label="Days"
        ref={grid}
        onKeyDown={onKey}
        // Keyed by month so a month change replays the slide (CSS .ds-cal-grid).
        key={f.getFullYear() * 12 + f.getMonth()}
        data-animate={animate}
      >
        {'Mo Tu We Th Fr Sa Su'.split(' ').map((d) => (
          <span key={d} className="ds-cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const iso = toIso(d)
          const outside = d.getMonth() !== f.getMonth()
          const off = (!!min && iso < min) || outside
          return (
            <button
              key={iso}
              type="button"
              tabIndex={iso === focus ? 0 : -1}
              disabled={off}
              aria-label={d.toLocaleDateString('en-GB', { dateStyle: 'long' })}
              aria-pressed={iso === value}
              data-outside={outside ? '' : undefined}
              data-today={iso === today ? '' : undefined}
              className="ds-cal-day"
              onClick={() => onPick(iso)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      <div className="ds-cal-foot">
        <button type="button" disabled={!!min && today < min} onClick={() => onPick(today)}>
          Today
        </button>
        <button type="button" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}

/** Returns the labelled field with its calendar. */
export function DatePicker({
  label,
  value,
  onChange,
  min,
  error,
  hint,
  required,
  disabled,
  name,
  describedBy: extraDescribedBy,
}: DatePickerProps) {
  const uid = useId()
  // On a phone the calendar is a centred card that takes focus, so the text can't be typed
  // into there: a tap opens the card, without flashing the number pad.
  const phone = useIsPhone()
  const [open, setOpen] = useState(false)
  // Opened from the calendar button (focus moves into the calendar) or the text (it stays).
  const [fromButton, setFromButton] = useState(false)
  const [text, setText] = useState(show(value))
  // A value changed from outside (a pick, Today, the form) replaces what is typed.
  const [seen, setSeen] = useState(value)
  // The value this field last reported itself: typed text is kept when the parent echoes it
  // back (including '' for half-typed text), and only replaced by a change from outside.
  const [sent, setSent] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (value !== sent) setText(show(value))
  }
  const report = (iso: string, invalid = false) => {
    setSent(iso)
    onChange(iso, { beforeMin: !!iso && !!min && iso < min, ...(invalid && { invalid }) })
  }
  // The mask only applies while typing at the end: an edit in the middle keeps the text as
  // typed, or the rewrite would move the caret to the end and scramble the date.
  const onType = (raw: string, atEnd: boolean) => {
    const t = atEnd ? maskTyped(raw) : raw
    setText(t)
    if (!t.trim()) return report('')
    const iso = parseTyped(t)
    // Text that is not a real date is reported as invalid, never silently kept as the old date.
    report(iso ?? '', !iso)
  }
  const msgId = error || hint ? `${uid}-msg` : undefined
  const describedBy = [msgId, extraDescribedBy].filter(Boolean).join(' ') || undefined
  return (
    <div className="ds-datepicker">
      {label ? (
        <span className="ds-datepicker-label">
          {label}
          {required ? (
            <span aria-hidden="true" style={{ color: 'var(--action-danger)', marginLeft: 3 }}>
              *
            </span>
          ) : null}
        </span>
      ) : null}
      <Popover
        open={open}
        onOpenChange={setOpen}
        ariaLabel={label ?? 'Choose a date'}
        align="left"
        sheetCentred
        style={{ display: 'flex' }}
        trigger={
          <span className="ds-field ds-datepicker-field" data-error={error ? '' : undefined}>
            <IconButton
              icon="calendar"
              label="Open calendar"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setFromButton(true)
                setOpen((o) => !o)
              }}
            />
            <span className="ds-datepicker-text">
              {/* The rest of dd/mm/yyyy, faint, after what is typed so far. */}
              {text && text.length < 10 && (
                <span className="ds-datepicker-mask" aria-hidden="true">
                  <span>{text}</span>
                  {'__/__/____'.slice(text.length)}
                </span>
              )}
              <input
                className="ds-field-input"
                name={name}
                inputMode="numeric"
                placeholder="dd/mm/yyyy"
                aria-label={label}
                aria-required={required || undefined}
                aria-invalid={!!error}
                aria-describedby={describedBy}
                disabled={disabled}
                readOnly={phone}
                value={text}
                onClick={() => {
                  setFromButton(false)
                  setOpen(true)
                }}
                onChange={(e) =>
                  onType(e.target.value, e.target.selectionStart === e.target.value.length)
                }
              />
            </span>
          </span>
        }
      >
        <Calendar
          // Remounts per open so the month starts on the chosen day.
          key={String(open) + value}
          value={value}
          min={min}
          focusDay={fromButton}
          onPick={(iso) => {
            report(iso)
            setOpen(false)
          }}
          onClear={() => {
            report('')
            setOpen(false)
          }}
        />
      </Popover>
      {error || hint ? (
        <span id={msgId} className="ds-datepicker-msg" data-error={error ? '' : undefined}>
          {error ? <Icon name="circle-alert" size={14} /> : null}
          {error || hint}
        </span>
      ) : null}
    </div>
  )
}
