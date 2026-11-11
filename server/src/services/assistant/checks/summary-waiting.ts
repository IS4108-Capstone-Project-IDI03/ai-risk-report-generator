// Generate (AS-06): the Executive Summary waits until Sections 3 to 12 are complete.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns a note while the summary can't be drafted yet. */
export function summaryWaiting(ctx: CheckContext): RaisedItem[] {
  const summary = ctx.summary?.executiveSummary
  if (ctx.stage !== 'generate' || !summary || summary.draft || !summary.missing.length) return []
  const n = summary.missing.length
  return [
    raise({
      id: 'generate.summary-waiting',
      kind: 'summary-waiting',
      stage: 'generate',
      weight: 'info',
      title: 'Executive Summary',
      detail: `Waits on ${plural(n, 'section')}`,
      fact: `The Executive Summary waits on ${plural(n, 'section')}.`,
      icon: 'hourglass',
      link: { tab: 'generate' },
      facts: { waitsOn: summary.missing.map((s) => s.id).join(',') },
    }),
  ]
}
