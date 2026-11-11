// Any stage before export (AS-06): the report is overdue (Fix now) or due soon.
import type { CheckContext } from '../context'
import { daysBetween, inDays, isoDay, longDay } from '../dates'
import { plural, raise, type RaisedItem } from '../item'
import { ASSISTANT } from '../settings'

/** Returns a Fix now item when the report is overdue, or a gap when it is due soon. */
export function reportDue(ctx: CheckContext): RaisedItem[] {
  const due = isoDay(ctx.assessment.reportDueDate)
  if (!due || ctx.stage === 'exported') return []
  const days = daysBetween(ctx.today, due)
  const base = {
    kind: 'report-due',
    stage: 'any' as const,
    title: 'Report',
    icon: 'calendar-clock',
    link: { tab: 'overview' as const },
  }
  if (days < 0)
    return [
      raise({
        ...base,
        id: 'any.overdue',
        weight: 'fix_now',
        detail: `${plural(-days, 'day')} overdue`,
        fact: `Report ${plural(-days, 'day')} overdue.`,
        facts: { due, overdue: -days },
      }),
    ]
  if (days > ASSISTANT.dueSoonDays) return []
  const when = inDays(days)
  return [
    raise({
      ...base,
      id: 'any.due-soon',
      weight: 'gap',
      detail: `Due ${when}, ${longDay(due)}`,
      fact: `Report due ${when}.`,
      facts: { due },
    }),
  ]
}
