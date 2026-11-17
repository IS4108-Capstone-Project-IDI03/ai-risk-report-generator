// Prepare (AS-06): the pre-survey checklist isn't generated yet.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap while the assessment in Prepare has no checklist. */
export function checklistMissing(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'prepare' || ctx.checklist) return []
  return [
    raise({
      id: 'prepare.checklist',
      kind: 'checklist-missing',
      stage: 'prepare',
      weight: 'gap',
      title: 'Checklist',
      detail: 'Not generated yet',
      fact: "The checklist isn't generated yet.",
      icon: 'list-checks',
      link: { tab: 'checklist' },
      facts: { checklist: false },
    }),
  ]
}
