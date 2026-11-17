// Exported (AS-06): the report changed after it was exported, so the copy sent
// is a version behind. MarshBot asks whether to export again.
import type { CheckContext } from '../context'
import { listed, raise, type RaisedItem } from '../item'
import { partTitle } from '../progress'

/**
 * Returns a note when sections changed since the latest export and the export
 * check came back empty; unknown blockers (null) offer nothing, so regenerating
 * and reviewing come first.
 */
export function staleExport(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'exported' || !ctx.changedSinceExport.length || ctx.blockers?.length !== 0)
    return []
  const names = ctx.changedSinceExport.map(partTitle)
  return [
    raise({
      id: 'exported.stale',
      kind: 'stale-export',
      stage: 'exported',
      weight: 'info',
      title: 'Exported Copy',
      detail: `${listed(names)} changed since the export`,
      fact: `${listed(names)} changed since the export.`,
      icon: 'file-clock',
      link: { tab: 'export' },
      facts: {
        changed: ctx.changedSinceExport.join(','),
        exportedAt: String(ctx.assessment.exportedAt?.toISOString()),
      },
    }),
  ]
}
