// Capture (AS-06): handwritten pages read as blank.
import { locationText } from '../../location.service'
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a gap per transcribed page with no handwriting and no correction. */
export function blankPages(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'capture') return []
  return ctx.observations.flatMap((o) =>
    o.pages
      .filter(
        (p) =>
          p.transcription.status === 'transcribed' &&
          !p.transcription.transcript?.trim() &&
          !p.transcription.correction,
      )
      .map((p) => {
        const title = o.location ? locationText(o.location) : 'An observation'
        return raise({
          id: `capture.blank-page:${o.id}:${p.id}`,
          kind: 'blank-page',
          stage: 'capture',
          weight: 'gap',
          title,
          detail: `${p.name} reads as blank`,
          fact: `${p.name} from ${title} reads as blank.`,
          icon: 'file-x',
          link: { tab: 'observations', params: { obs: o.id } },
          facts: { page: p.name },
        })
      }),
  )
}
