// Generate (AS-06): report parts not drafted yet, in one line.
import type { CheckContext } from '../context'
import { listed, raise, type RaisedItem } from '../item'
import { partTitle, PARTS } from '../progress'

/** Returns one gap naming the parts with no draft. */
export function notDrafted(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'generate') return []
  const left = PARTS.filter((id) => !ctx.draftedParts.includes(id))
  if (!left.length) return []
  const names = left.map(partTitle)
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names
  return [
    raise({
      id: 'generate.not-drafted',
      kind: 'not-drafted',
      stage: 'generate',
      weight: 'gap',
      title: 'Still to Draft',
      detail: listed(shown),
      fact: `${listed(shown)} ${left.length === 1 ? 'is' : 'are'} not drafted yet.`,
      icon: 'file-pen',
      link: { tab: 'generate' },
      facts: { left: left.join(',') },
    }),
  ]
}
