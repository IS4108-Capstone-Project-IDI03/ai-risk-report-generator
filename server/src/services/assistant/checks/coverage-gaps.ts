// Prepare to Generate (AS-06 AC 7): what the coverage check found: checklist
// items no observation covers, by area, and observations too thin for their
// section. Raised from the stored result, so they show after the rest.
import { locationText } from '../../location.service'
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'
import { stageIndex } from '../stage'

/** Returns a gap per area with uncovered items, and per thin observation. */
export function coverageGaps(ctx: CheckContext): RaisedItem[] {
  const i = stageIndex(ctx.stage)
  if (!ctx.checklist || i < stageIndex('prepare') || i >= stageIndex('review')) return []
  const uncovered = new Set(ctx.coverage.uncovered)
  const titles = new Map(ctx.checklist.areas.map((a) => [a.id, a.title]))
  // Items answered since the check ran are covered now.
  const byArea = new Map<string, number>()
  for (const item of ctx.checklist.items)
    if (item.status === 'active' && !item.check && uncovered.has(item.id))
      byArea.set(item.area, (byArea.get(item.area) ?? 0) + 1)
  const sectionTitle = (id: string) =>
    ctx.sections?.find((s) => s.section.id === id)?.section.title ??
    titles.get(id) ??
    `Section ${id}`
  // Worst area first, as the health bars (ctx.areas) are.
  const rank = (area: string) => ctx.areas.findIndex((a) => a.area === titles.get(area))
  return [
    ...[...byArea]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([area, n]) => {
        const title = titles.get(area) ?? area
        return raise({
          id: `coverage.uncovered:${area}`,
          kind: 'coverage-uncovered',
          stage: 'capture',
          weight: 'gap',
          title,
          detail: `${plural(n, 'checklist item')} no observation covers`,
          fact: `${title} has ${plural(n, 'checklist item')} no observation covers.`,
          icon: 'list-x',
          link: { tab: 'checklist', params: { area: title } },
          facts: { uncovered: n },
        })
      }),
    ...ctx.coverage.thin.flatMap((t) => {
      const o = ctx.observations.find((x) => x.id === t.observationId)
      if (!o) return []
      const section = sectionTitle(t.sectionId)
      return [
        raise({
          id: `coverage.thin:${o.id}:${t.sectionId}`,
          kind: 'coverage-thin',
          stage: 'capture',
          weight: 'gap',
          title: o.location ? locationText(o.location) : 'An observation',
          detail: `Thin for ${section}: ${t.reason}`,
          fact: `An observation at ${o.location ? locationText(o.location) : 'the site'} is thin for ${section}.`,
          icon: 'file-minus',
          link: { tab: 'observations', params: { obs: o.id } },
          facts: { section, reason: t.reason },
        }),
      ]
    }),
  ]
}
