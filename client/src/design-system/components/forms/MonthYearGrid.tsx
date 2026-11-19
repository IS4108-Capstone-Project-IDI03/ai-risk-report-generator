// Month and year grid (CP-60): the twelve months of a year, or twelve years, three to a row,
// with the chosen one marked and this month or year ringed. The arrow keys move between them
// from one tab stop, never before min. Called by DatePicker's Calendar, in place of its days,
// and the Calendar page's period heading (features/calendar/screens/Calendar.tsx), in a
// popover. The caller draws the heading and its arrows above it.
import { useEffect, useRef, useState } from 'react'

const MONTH_NAMES =
  'January February March April May June July August September October November December'.split(' ')

export function MonthYearGrid({
  kind,
  year,
  month,
  page,
  min,
  onPick,
  onPage,
  onEscape,
  animate,
  minHeight,
}: {
  kind: 'months' | 'years'
  // The chosen year, and month (0 to 11).
  year: number
  month: number
  // The year whose months show, or the first of the twelve years.
  page: number
  // The earliest month that can be picked (month 0 to 11).
  min?: { year: number; month: number }
  // A month (0 to 11) of `page`, or a year.
  onPick: (value: number) => void
  // The arrow keys went past the page's first or last year: show twelve earlier or later.
  onPage?: (by: number) => void
  // Given, Esc calls it and nothing around hears the key (the calendar goes back to its days).
  // Left out, Esc is left to the popover around, which closes.
  onEscape?: () => void
  // Which way the page came in, for its slide.
  animate?: 'next' | 'prev'
  // The space to fill, so the calendar keeps the size its days gave it.
  minHeight?: number
}) {
  const now = new Date()
  const items =
    kind === 'months'
      ? MONTH_NAMES.map((name, m) => ({
          value: m,
          text: name.slice(0, 3),
          label: `${name} ${page}`,
          off: !!min && (page < min.year || (page === min.year && m < min.month)),
          pressed: page === year && m === month,
          today: page === now.getFullYear() && m === now.getMonth(),
        }))
      : Array.from({ length: 12 }, (_, i) => page + i).map((y) => ({
          value: y,
          text: String(y),
          label: undefined,
          off: !!min && y < min.year,
          pressed: y === year,
          today: y === now.getFullYear(),
        }))
  // The month or year with the one tab stop: the chosen one, else the first that can be picked.
  const [choice, setChoice] = useState(kind === 'months' ? month : year)
  const tab = (items.find((i) => i.value === choice && !i.off) ?? items.find((i) => !i.off))?.value
  // Focus goes in when the grid shows and follows the arrow keys; an arrow button that pages
  // it keeps its own focus.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }, [choice])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!onEscape) return
      // Also cancelled, so a dialog around it gets no close request.
      e.stopPropagation()
      e.preventDefault()
      return onEscape()
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    if (kind === 'months') {
      // Within the year shown; the arrows above step the year.
      let m = Math.min(11, Math.max(0, choice + step))
      if (min && page === min.year && m < min.month) m = min.month
      return setChoice(m)
    }
    let y = choice + step
    if (min && y < min.year) y = min.year
    if (y < page) onPage?.(-12)
    else if (y > page + 11) onPage?.(12)
    setChoice(y)
  }
  return (
    <div
      className="ds-cal-choices"
      role="group"
      aria-label={kind === 'months' ? 'Months' : 'Years'}
      ref={box}
      onKeyDown={onKeyDown}
      style={{ minHeight }}
    >
      {/* Keyed by page, so a new year, or page of years, slides in. */}
      <div className="ds-cal-choices-page" key={page} data-animate={animate}>
        {items.map((i) => (
          <button
            key={i.value}
            type="button"
            tabIndex={i.value === tab ? 0 : -1}
            disabled={i.off}
            aria-label={i.label}
            aria-pressed={i.pressed}
            data-today={i.today ? '' : undefined}
            className="ds-cal-choice"
            onClick={() => onPick(i.value)}
          >
            {i.text}
          </button>
        ))}
      </div>
    </div>
  )
}
