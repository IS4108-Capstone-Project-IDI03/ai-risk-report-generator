// Ready for generation and Generate (AS-06): transcriptions still running,
// which drafting waits for.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns one note while any recording or page is still being transcribed. */
export function transcribing(ctx: CheckContext): RaisedItem[] {
  if (!['ready_for_generation', 'generate'].includes(ctx.stage)) return []
  const n = ctx.observations
    .flatMap((o) => [...o.recordings, ...o.pages])
    .filter((m) => m.transcription.status === 'transcribing').length
  if (!n) return []
  return [
    raise({
      id: 'transcribing',
      kind: 'transcribing',
      stage: 'ready_for_generation',
      weight: 'info',
      title: 'Transcription',
      detail: `${plural(n, 'recording or page', 'recordings or pages')} still running`,
      fact: `${plural(n, 'recording or page', 'recordings or pages')} still being transcribed.`,
      icon: 'loader',
      link: { tab: 'observations' },
      facts: { running: n },
    }),
  ]
}
