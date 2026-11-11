// Capture to Generate (AS-06): observations with no COPE category, which
// drafting leaves out (CP-02 AC4).
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns one gap counting the uncategorised observations. */
export function uncategorised(ctx: CheckContext): RaisedItem[] {
  if (!['capture', 'ready_for_generation', 'generate'].includes(ctx.stage)) return []
  const n = ctx.observations.filter((o) => !o.copeDimensions).length
  if (!n) return []
  const capturing = ctx.stage === 'capture'
  return [
    raise({
      id: 'uncategorised',
      kind: 'uncategorised',
      stage: capturing ? 'capture' : 'ready_for_generation',
      weight: 'gap',
      title: 'Uncategorised observations',
      detail: capturing
        ? `${plural(n, 'observation')} with no category yet`
        : `${plural(n, 'observation')} left out of drafting`,
      fact: capturing
        ? `${plural(n, 'observation')} with no category yet.`
        : `${plural(n, 'uncategorised observation')} left out of drafting.`,
      icon: 'tag',
      link: { tab: 'observations' },
      facts: { uncategorised: n },
    }),
  ]
}
