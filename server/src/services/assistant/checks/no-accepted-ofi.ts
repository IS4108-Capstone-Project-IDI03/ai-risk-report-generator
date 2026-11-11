// Generate (AS-06): no Opportunity for Improvement accepted yet, which the export needs.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap while no OFI is accepted. */
export function noAcceptedOfi(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'generate' || !ctx.ofis || ctx.ofis.accepted.length) return []
  const drafted = ctx.ofis.suggestions.length > 0
  return [
    raise({
      id: 'generate.no-ofi',
      kind: 'no-accepted-ofi',
      stage: 'generate',
      weight: 'gap',
      title: 'Opportunities for Improvement',
      detail: drafted ? 'None accepted yet' : 'Not drafted yet',
      fact: drafted
        ? 'No Opportunity for Improvement is accepted yet.'
        : 'Opportunities for Improvement are not drafted yet.',
      icon: 'lightbulb',
      link: { tab: drafted ? 'review' : 'generate', params: { section: '3' } },
      facts: { drafted },
    }),
  ]
}
