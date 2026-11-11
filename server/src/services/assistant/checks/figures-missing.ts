// Generate and Review (AS-06): Section 4's scores or Section 5's figures not
// all entered, which drafting and export need.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'
import { partTitle } from '../progress'
import { figureFacts } from '../../section.service'

/** Returns a gap for Section 4 and 5 while their figures are missing. */
export function figuresMissing(ctx: CheckContext): RaisedItem[] {
  if (!['generate', 'review'].includes(ctx.stage)) return []
  return ['4', '5'].flatMap((id) => {
    const missing = figureFacts(id, ctx.assessment).missing
    if (!missing) return []
    const title = partTitle(id)
    return [
      raise({
        id: `generate.figures:${id}`,
        kind: 'figures-missing',
        stage: 'generate',
        weight: 'gap',
        title,
        detail: id === '4' ? 'Scores not all entered' : 'Figures not all entered',
        fact: `Not all ${id === '4' ? 'scores' : 'figures'} are entered for ${title}.`,
        icon: 'calculator',
        link: { tab: 'generate', params: { section: id } },
        facts: { missing },
      }),
    ]
  })
}
