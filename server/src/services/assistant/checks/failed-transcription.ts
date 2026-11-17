// Any stage (AS-06 Fix now): recordings and handwritten pages whose
// transcription failed, each with a retry in place. A retried one stays raised
// while it transcribes again (status busy), so MarshBot's row turns into
// "Transcribing" and then "Done" instead of vanishing (round 5, C2).
import { locationText } from '../../location.service'
import type { ObservationDto } from '../../observation.service'
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

type Media = ObservationDto['recordings'][number] | ObservationDto['pages'][number]

// Failed, or transcribing again after a failure (more than one attempt). The
// first attempt is the upload's own, so a fresh recording is never raised.
const status = (m: Media) =>
  m.transcription.status === 'failed'
    ? 'failed'
    : m.transcription.status === 'transcribing' && m.transcription.attempts > 1
      ? 'busy'
      : null

/** Returns a Fix now item per failed recording or page, and per one being retried. */
export function failedTranscription(ctx: CheckContext): RaisedItem[] {
  return ctx.observations.flatMap((o) => {
    const title = o.location ? locationText(o.location) : 'An observation'
    const link = { tab: 'observations' as const, params: { obs: o.id } }
    const item = (m: Media, page: boolean) => {
      const now = status(m)!
      const busy = now === 'busy'
      return raise({
        id: `capture.failed-${page ? 'page' : 'recording'}:${o.id}:${m.id}`,
        kind: page ? 'failed-page' : 'failed-recording',
        stage: 'capture',
        weight: 'fix_now',
        title,
        detail: `${m.name} · ${busy ? 'Transcribing' : page ? "Couldn't read" : "Couldn't transcribe"}`,
        fact: busy
          ? `A ${page ? 'handwritten page' : 'recording'} from ${title} is being transcribed again.`
          : page
            ? `A handwritten page from ${title} couldn't be read.`
            : `A recording from ${title} couldn't be transcribed.`,
        icon: page ? 'scan-text' : 'mic',
        link,
        action: busy ? null : page ? 'retry-page' : 'retry-transcription',
        actionTarget: busy ? null : `${o.id}:${m.id}`,
        facts: {
          [page ? 'page' : 'recording']: m.name,
          attempts: m.transcription.attempts,
          status: now,
        },
      })
    }
    return [
      ...o.recordings.filter(status).map((r) => item(r, false)),
      ...o.pages.filter(status).map((p) => item(p, true)),
    ]
  })
}
