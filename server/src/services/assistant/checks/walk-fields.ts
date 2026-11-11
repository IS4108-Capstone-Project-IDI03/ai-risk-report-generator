// Capture (AS-06): a site walk's proposed observations the AI couldn't fill
// in fully (severity, category or location flagged to check).
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns a gap per ready site walk with proposed observations to complete. */
export function walkFields(ctx: CheckContext): RaisedItem[] {
  return ctx.walks.flatMap((w) => {
    if (w.status !== 'ready') return []
    const n = (w.proposal?.observations ?? []).filter(
      (o) => o.check.severity || o.check.category || o.check.location,
    ).length
    if (!n) return []
    return [
      raise({
        id: `walk.fields:${w.id}`,
        kind: 'walk-fields',
        stage: 'capture',
        weight: 'gap',
        title: w.name ?? 'Site walk',
        detail: `${plural(n, 'proposed observation')} to complete`,
        fact: `${w.name ?? 'Site walk'} has ${plural(n, 'proposed observation')} to complete.`,
        icon: 'pencil',
        link: { tab: 'observations', params: { walk: w.id } },
        facts: { toComplete: n },
      }),
    ]
  })
}
