// The calendar on a phone (CP-60): the month as a list of its days that hold
// something, each survey and report due date a row, since seven columns do not
// fit 375 px. Called by screens/Calendar.tsx. Calls Entry.
import { EmptyState } from '../../../design-system'
import { formatWeekday, spokenDay, type AgendaDay } from '../calendar'
import { EntryRow, type EntryContext } from './Entry'

export function DayList({ days, ctx }: { days: AgendaDay[]; ctx: EntryContext }) {
  if (!days.length)
    return (
      <EmptyState
        icon="calendar"
        title="Nothing this month"
        description="No surveys or reports are due. Step to another month, or clear the filters."
      />
    )
  return (
    <div className="cal-list">
      {days.map(({ day, entries }) => (
        <section key={day} aria-label={spokenDay(day)}>
          <h2 className="cal-list-day" data-today={day === ctx.today ? '' : undefined}>
            {day === ctx.today ? `Today · ${formatWeekday(day)}` : formatWeekday(day)}
          </h2>
          {entries.map((entry) => (
            <EntryRow
              key={entry.key}
              entryKey={entry.key}
              item={entry.item}
              kind={entry.kind}
              ctx={ctx}
              where="list"
            />
          ))}
        </section>
      ))}
    </div>
  )
}
