// The calendar's grid (CP-60): the weekday names, then one row per week, six for a
// month or one for a week. Each week is one CSS grid: the days are its columns,
// stretched over every row, and the entries sit in rows (lanes) over them, so a
// survey of several days is one bar. Called by screens/Calendar.tsx. Calls Entry.
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { IconButton } from '../../../design-system'
import {
  addDays,
  formatDay,
  MONTH_LANES,
  spokenDay,
  WEEKDAYS,
  type View,
  type Week,
} from '../calendar'
import { EntryChip, type EntryContext } from './Entry'

export function CalendarGrid({
  view,
  weeks,
  month,
  ctx,
  onWeek,
  onAdd,
}: {
  view: View
  weeks: Week[]
  // The month shown ("2026-11"): days outside it are greyed. The week view greys none.
  month: string | null
  ctx: EntryContext
  // Opens the week holding a day, from its date or its "+N more".
  onWeek: (day: string) => void
  // Starts a new assessment on a day; absent for someone who may not create one.
  onAdd?: (day: string) => void
}) {
  const first = weeks[0].days[0]
  const last = weeks[weeks.length - 1].days[6]
  // One day is the grid's tab stop, moved by the arrow keys, as in the date picker.
  const [focusDay, setFocusDay] = useState(ctx.today)
  const stop =
    focusDay >= first && focusDay <= last ? focusDay : (month ?? first.slice(0, 7)) + '-01'
  const tabStop = stop >= first && stop <= last ? stop : first
  const grid = useRef<HTMLDivElement>(null)
  // After a keyboard move the new day takes focus; a click or a new month does not.
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [focusDay])
  const onKey = (e: React.KeyboardEvent, day: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step === undefined) return
    const next = addDays(day, step)
    // The grid's own days only: the arrows above the grid change the period.
    if (next < first || next > last) return
    e.preventDefault()
    moved.current = true
    setFocusDay(next)
  }
  const tall = view === 'week'
  return (
    <div className="cal-grid" data-view={view} ref={grid} data-walk="calendar.grid">
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {weeks.map((week) => {
        // A month's week keeps a row for "+N more"; a week view grows with what it holds.
        const lanes = tall ? Math.max(week.lanes, 1) : MONTH_LANES + 1
        return (
          <div
            key={week.start}
            className="cal-week"
            style={{
              gridTemplateRows: `30px repeat(${lanes}, var(--cal-lane)) minmax(8px, 1fr)`,
            }}
          >
            {week.days.map((day, i) => {
              const isToday = day === ctx.today
              const date = +day.slice(8)
              // The first of a month names it, so a grid that crosses months reads clearly.
              const text = date === 1 ? formatDay(day).replace(/ \d{4}$/, '') : String(date)
              const name = spokenDay(day) + (isToday ? ', today' : '')
              return (
                <div
                  key={day}
                  className="cal-day"
                  style={{ gridColumn: i + 1 }}
                  data-outside={month && !day.startsWith(month) ? '' : undefined}
                  data-today={isToday ? '' : undefined}
                >
                  {tall ? (
                    <span className="cal-date" aria-label={name}>
                      {text}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="cal-date"
                      data-day={day}
                      tabIndex={day === tabStop ? 0 : -1}
                      aria-label={`${name}. Show this week`}
                      title="Show this week"
                      onClick={() => onWeek(day)}
                      onKeyDown={(e) => onKey(e, day)}
                    >
                      {text}
                    </button>
                  )}
                  {onAdd && (
                    <IconButton
                      icon="plus"
                      size="sm"
                      className="cal-add"
                      label={`New assessment on ${formatDay(day)}`}
                      tooltip="New assessment"
                      tabIndex={tall || day === tabStop ? 0 : -1}
                      onClick={() => onAdd(day)}
                    />
                  )}
                </div>
              )
            })}
            {week.entries.map((entry) => (
              <EntryChip
                key={entry.key}
                entryKey={entry.key}
                item={entry.item}
                kind={entry.kind}
                ctx={ctx}
                week={week.start}
                twoLines={tall}
                fromEarlier={entry.fromEarlier}
                toLater={entry.toLater}
                // Details open towards the middle of the week, so they stay on the card.
                align={entry.col > 3 ? 'right' : 'left'}
                style={{
                  gridColumn: `${entry.col + 1} / span ${entry.span}`,
                  gridRow: entry.lane + 2,
                }}
              />
            ))}
            {week.more.map((count, col) =>
              count ? (
                <button
                  key={col}
                  type="button"
                  className="cal-more"
                  style={{ gridColumn: col + 1, gridRow: MONTH_LANES + 2 }}
                  aria-label={`${count} more on ${formatDay(week.days[col])}. Show this week`}
                  title="Show this week"
                  onClick={() => onWeek(week.days[col])}
                >
                  {`+${count} more`}
                </button>
              ) : null,
            )}
          </div>
        )
      })}
    </div>
  )
}
