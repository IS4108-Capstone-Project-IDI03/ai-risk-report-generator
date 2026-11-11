// Capture (AS-06): handwritten pages with words the model was unsure of,
// not yet corrected by the engineer.
import { locationText } from '../../location.service'
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns a gap per transcribed page with unsure words and no correction. */
export function unsureWords(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'capture') return []
  return ctx.observations.flatMap((o) =>
    o.pages
      .filter(
        (p) =>
          p.transcription.status === 'transcribed' &&
          p.transcription.uncertain.length &&
          !p.transcription.correction,
      )
      .map((p) => {
        const title = o.location ? locationText(o.location) : 'An observation'
        return raise({
          id: `capture.unsure:${o.id}:${p.id}`,
          kind: 'unsure-words',
          stage: 'capture',
          weight: 'gap',
          title,
          fact: `${p.name} from ${title} has ${plural(p.transcription.uncertain.length, 'unsure word')}.`,
          detail: `${plural(p.transcription.uncertain.length, 'unsure word')} on ${p.name}`,
          icon: 'file-question',
          link: { tab: 'observations', params: { obs: o.id } },
          facts: { unsure: p.transcription.uncertain.length, page: p.name },
        })
      }),
  )
}
