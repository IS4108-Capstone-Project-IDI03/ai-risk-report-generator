// Generate, and once ready to export or exported (AS-06): drafts whose evidence, figures or
// scope changed since they were drafted.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns a gap per section whose draft is out of date. */
export function outOfDate(ctx: CheckContext): RaisedItem[] {
  if (!['generate', 'ready_to_export', 'exported'].includes(ctx.stage)) return []
  return (ctx.sections ?? [])
    .filter((s) => s.latest && s.changesSinceDraft > 0)
    .map(({ section, changesSinceDraft: n }) =>
      raise({
        id: `generate.out-of-date:${section.id}`,
        kind: 'out-of-date',
        stage: 'generate',
        weight: 'gap',
        title: section.title,
        detail: `${plural(n, 'change')} since it was drafted`,
        fact: `${section.title} has ${plural(n, 'change')} since it was drafted.`,
        icon: 'refresh-cw',
        link: { tab: 'generate', params: { section: section.id } },
        facts: { changes: n },
      }),
    )
}
