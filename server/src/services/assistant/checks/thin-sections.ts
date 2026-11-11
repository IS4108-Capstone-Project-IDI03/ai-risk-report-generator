// Ready for generation and Generate (AS-06): undrafted sections with fewer
// usable observations than the template needs to draft them.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap per undrafted section below its minimum number of observations. */
export function thinSections(ctx: CheckContext): RaisedItem[] {
  if (!['ready_for_generation', 'generate'].includes(ctx.stage)) return []
  return (ctx.sections ?? [])
    .filter((s) => !s.latest && s.usableObservations < s.section.min_observations)
    .map(({ section, usableObservations: have }) =>
      raise({
        id: `section.thin:${section.id}`,
        kind: 'thin-sections',
        stage: 'ready_for_generation',
        weight: 'gap',
        title: section.title,
        detail: `${have} of ${section.min_observations} observations needed`,
        fact: `${section.title} has ${have} of the ${section.min_observations} observations it needs.`,
        icon: 'layers',
        link: { tab: 'observations' },
        facts: { have, needed: section.min_observations },
      }),
    )
}
