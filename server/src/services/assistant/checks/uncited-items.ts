// Prepare (AS-06): checklist items that rest on no standard's passage.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns one gap counting the active uncited checklist items. */
export function uncitedItems(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'prepare' || !ctx.checklist) return []
  const n = ctx.checklist.items.filter(
    (i) => i.status === 'active' && i.flags.includes('uncited'),
  ).length
  if (!n) return []
  return [
    raise({
      id: 'prepare.uncited',
      kind: 'uncited-items',
      stage: 'prepare',
      weight: 'gap',
      title: 'Checklist',
      detail: `${plural(n, 'item')} cite no standard`,
      fact: `${plural(n, 'checklist item')} cite no standard.`,
      icon: 'quote',
      link: { tab: 'checklist' },
      facts: { uncited: n },
    }),
  ]
}
