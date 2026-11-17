// Prepare (AS-06 AC 8): with the survey 3 days away or less, whether the
// engineer has read the checklist ("read" = activity.ts wasRead).
import { wasRead } from '../activity'
import type { CheckContext } from '../context'
import { daysBetween, inDays, isoDay } from '../dates'
import { raise, type RaisedItem } from '../item'
import { ASSISTANT } from '../settings'

/** Returns a reminder to read the checklist, or a note that the engineer is set. */
export function checklistRead(ctx: CheckContext): RaisedItem[] {
  const survey = isoDay(ctx.assessment.siteVisitDate)
  if (!['setup', 'prepare'].includes(ctx.stage) || !ctx.checklist || !survey) return []
  const days = daysBetween(ctx.today, survey)
  if (days < 0 || days > ASSISTANT.checklistReminderDays) return []
  const ids = ctx.checklist.items.filter((i) => i.status === 'active').map((i) => i.id)
  // Read on screen, long enough on the checklist, or ticked by the engineer since this checklist
  // was made (round 11).
  // shortcut: engaged time is one running total, so time on a checklist made earlier counts too;
  // reset it on a new checklist if a remade checklist ticks before anyone reads it.
  const activity = ctx.activity.get('checklist')
  const marked = ctx.checklistReadAt && ctx.checklistReadAt >= new Date(ctx.checklist.createdAt)
  const read =
    marked ||
    (activity?.engagedMs ?? 0) >= ids.length * ASSISTANT.checklistMsPerItem ||
    wasRead(activity?.seen, ids)
  const link = { tab: 'checklist' as const }
  const when = inDays(days)
  return [
    read
      ? raise({
          id: 'prepare.checklist-ready',
          kind: 'checklist-read',
          stage: 'prepare',
          weight: 'info',
          title: 'Checklist',
          detail: 'Read through',
          fact: `Survey ${when}, checklist read.`,
          icon: 'check',
          link,
          facts: { read: true, survey },
        })
      : raise({
          id: 'prepare.checklist-read',
          kind: 'checklist-read',
          stage: 'prepare',
          weight: 'reminder',
          title: 'Checklist',
          detail: 'Not read through yet',
          fact: `Survey ${when}, checklist not read yet.`,
          icon: 'book-open',
          link,
          facts: { read: false, survey },
        }),
  ]
}
