// Any stage (AS-06 Fix now): recordings and handwritten pages whose
// transcription failed, each with a retry in place.
import { locationText } from '../../location.service'
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

/** Returns a Fix now item per failed recording or page. */
export function failedTranscription(ctx: CheckContext): RaisedItem[] {
  return ctx.observations.flatMap((o) => {
    const title = o.location ? locationText(o.location) : 'An observation'
    const link = { tab: 'observations' as const, params: { obs: o.id } }
    return [
      ...o.recordings
        .filter((r) => r.transcription.status === 'failed')
        .map((r) =>
          raise({
            id: `capture.failed-recording:${o.id}:${r.id}`,
            kind: 'failed-recording',
            stage: 'capture',
            weight: 'fix_now',
            title,
            detail: `${r.name} · Couldn't transcribe`,
            fact: `A recording from ${title} couldn't be transcribed.`,
            icon: 'mic',
            link,
            action: 'retry-transcription',
            actionTarget: `${o.id}:${r.id}`,
            facts: { recording: r.name, attempts: r.transcription.attempts },
          }),
        ),
      ...o.pages
        .filter((p) => p.transcription.status === 'failed')
        .map((p) =>
          raise({
            id: `capture.failed-page:${o.id}:${p.id}`,
            kind: 'failed-page',
            stage: 'capture',
            weight: 'fix_now',
            title,
            detail: `${p.name} · Couldn't read`,
            fact: `A handwritten page from ${title} couldn't be read.`,
            icon: 'scan-text',
            link,
            action: 'retry-page',
            actionTarget: `${o.id}:${p.id}`,
            facts: { page: p.name, attempts: p.transcription.attempts },
          }),
        ),
    ]
  })
}
