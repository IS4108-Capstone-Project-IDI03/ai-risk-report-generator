// Segmented control (CP-23, v2 section 6) and its assessment-type form.
// Called by the New Assessment form and the client page. Calls Icon.
import { useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { ASSESSMENT_TYPES } from '../display/AssessmentTypeTile'
import type { AssessmentType } from '../display/AssessmentTypeTile'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: string
  // A disabled option looks disabled and cannot be chosen.
  disabled?: boolean
  // Text colour of this option, e.g. its assessment type's colour.
  color?: string
  // A small count after the label (the Inbox's To do, F-10); none when undefined or 0.
  count?: number
}

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}

/** Returns a pill-shaped single-choice control (radiogroup) with an optional icon per option. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  // Arrow keys move the choice, skipping disabled options; without this a keyboard user
  // would tab through every option.
  const enabled = options.filter((o) => !o.disabled)
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: T) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step || !enabled.length) return
    event.preventDefault()
    const at = enabled.findIndex((o) => o.value === current)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    onChange(next.value)
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[options.indexOf(next)]?.focus()
  }
  // One tab stop: the chosen option (or the first enabled one when none is chosen).
  const stop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value
  // The white thumb slides to the chosen option (180 ms ease-out, board 17 · 5): its box
  // is measured from the chosen button. The first placement has no transition.
  const root = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number; slide: boolean } | null>(null)
  useLayoutEffect(() => {
    const at = options.findIndex((o) => o.value === value)
    const box = root.current
    const el = box?.querySelectorAll<HTMLElement>('button')[at]
    if (!box || !el) return setThumb(null)
    const measure = () => setThumb((t) => ({ x: el.offsetLeft, w: el.offsetWidth, slide: !!t }))
    measure()
    // The thumb follows the chosen button when the control resizes (phone width, fonts loading),
    // without sliding: a resize is not a choice. The observer's first call is the initial size.
    let first = true
    const follow = () => {
      if (first) return void (first = false)
      setThumb({ x: el.offsetLeft, w: el.offsetWidth, slide: false })
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow)
    ro?.observe(box)
    return () => ro?.disconnect()
  }, [value, options.length, options.map((o) => o.label).join()])
  return (
    <div className="ds-segmented" role="radiogroup" aria-label={ariaLabel} ref={root}>
      {thumb && (
        <span
          className="ds-seg-thumb"
          aria-hidden="true"
          data-slide={thumb.slide ? '' : undefined}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === stop ? 0 : -1}
          disabled={o.disabled}
          style={o.color ? { color: o.color } : undefined}
          title={o.label}
          aria-label={o.count ? `${o.label}, ${o.count}` : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, o.value)}
        >
          {o.icon ? <Icon name={o.icon} size={14} /> : null}
          {o.label}
          {o.count ? <span className="ds-seg-count">{o.count > 99 ? '99+' : o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export type AssessmentTypeControlProps = {
  value: AssessmentType
  onChange: (value: AssessmentType) => void
  // Types that cannot be chosen, e.g. ['Follow-up'] when the site has no earlier assessment.
  disabled?: AssessmentType[]
}

/** Returns the First survey / Resurvey / Follow-up control, each with its icon. */
export function AssessmentTypeControl({
  value,
  onChange,
  disabled = [],
}: AssessmentTypeControlProps) {
  const options = (Object.keys(ASSESSMENT_TYPES) as AssessmentType[]).map((t) => ({
    value: t,
    label: t,
    icon: ASSESSMENT_TYPES[t].icon,
    disabled: disabled.includes(t),
    color: ASSESSMENT_TYPES[t].fg,
  }))
  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      ariaLabel="Assessment type"
    />
  )
}
