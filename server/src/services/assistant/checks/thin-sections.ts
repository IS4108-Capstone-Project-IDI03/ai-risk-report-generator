// Ready for generation and Generate (AS-06): undrafted sections with fewer
// usable observations than the template needs to draft them.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

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
        detail: `${have} of ${plural(section.min_observations, 'observation')} needed`,
        fact: `${section.title} has ${have} of the ${plural(section.min_observations, 'observation')} it needs.`,
        icon: 'layers',
        link: { tab: 'observations' },
        facts: { have, needed: section.min_observations },
      }),
    )
}
