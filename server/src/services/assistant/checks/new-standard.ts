// Prepare (AS-06): a standard that applies to the site was added to the
// knowledge base after the checklist was generated.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap per applicable standard newer than the checklist and not in it. */
export function newStandard(ctx: CheckContext): RaisedItem[] {
  const checklist = ctx.checklist
  if (!checklist || !['prepare', 'capture'].includes(ctx.stage)) return []
  const used = new Set(checklist.standards.map((s) => s.id))
  return ctx.standards
    .filter((s) => !used.has(s.id) && new Date(s.uploadedAt) > new Date(checklist.createdAt))
    .map((s) =>
      raise({
        id: `prepare.new-standard:${s.id}`,
        kind: 'new-standard',
        stage: 'prepare',
        weight: 'gap',
        title: s.title,
        detail: 'Added since the checklist was made',
        fact: `${s.title} was added since the checklist was made.`,
        icon: 'file-plus',
        link: { tab: 'checklist' },
        facts: { standard: s.title },
      }),
    )
}
