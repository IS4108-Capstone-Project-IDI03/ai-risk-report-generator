// Prepare (AS-06): the survey day has passed and nothing was captured.
import type { CheckContext } from '../context'
import { isoDay, longDay } from '../dates'
import { raise, type RaisedItem } from '../item'

/** Returns a gap when the last survey day is past and no capture has started. */
export function surveyPassedEmpty(ctx: CheckContext): RaisedItem[] {
  const a = ctx.assessment
  const end = isoDay(a.siteVisitEndDate ?? a.siteVisitDate)
  if (!['setup', 'prepare'].includes(ctx.stage) || !end || end >= ctx.today || ctx.captureStarted)
    return []
  return [
    raise({
      id: 'prepare.survey-passed',
      kind: 'survey-passed-empty',
      stage: 'prepare',
      weight: 'gap',
      title: 'Survey',
      detail: `Was on ${longDay(end)}, nothing captured yet`,
      fact: `Survey was on ${longDay(end)}, nothing captured yet.`,
      icon: 'calendar-x',
      link: { tab: 'observations' },
      facts: { survey: end },
    }),
  ]
}
