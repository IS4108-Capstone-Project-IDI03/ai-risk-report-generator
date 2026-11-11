// Capture (AS-06): checklist areas with nothing recorded, or items still
// unanswered, each linking to the checklist filtered to that area.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap per checklist area with unanswered items. */
export function areaGaps(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'capture') return []
  return ctx.areas
    .filter((a) => a.covered < a.total)
    .map((a) =>
      raise({
        id: `capture.area:${a.area}`,
        kind: 'area-gaps',
        stage: 'capture',
        weight: 'gap',
        title: a.area,
        detail: a.covered ? `${a.covered} of ${a.total} answered` : 'Nothing recorded yet',
        fact: a.covered
          ? `${a.area} is at ${a.covered} of ${a.total} answered.`
          : `${a.area} has nothing recorded yet.`,
        icon: 'layout-list',
        link: { tab: 'checklist', params: { area: a.area } },
        facts: { covered: a.covered, total: a.total },
      }),
    )
}
