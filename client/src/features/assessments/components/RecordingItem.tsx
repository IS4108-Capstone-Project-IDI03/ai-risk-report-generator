// One recording on the observation page (CP-03, CP-08, CP-22, CP-24): the shared recording row
// (site-walk/components/RecordingRow.tsx) with a pencil that corrects the transcript, the red bin
// and the chevron that opens the transcript. A walk clip plays only its own part of the walk.
// Rendered by components/RecordingsCard.tsx. Calls RecordingRow.
import { useEffect, useState } from 'react'
import { RecordingRow } from '../../site-walk/components/RecordingRow'
import type { ObservationRowView } from '../useObservationsView'

type Recording = ObservationRowView['recordings'][number]

// A saved recording's length, read from its own audio header once it loads (the gateway stores
// none); null until then, and for a file the browser can't read. `skip` leaves a walk clip alone.
function useAudioSeconds(url: string, skip: boolean) {
  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (skip || !url) return
    const el = new Audio()
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      setSeconds(Number.isFinite(el.duration) ? Math.round(el.duration) : null)
    el.src = url
    // Without this the element would keep its download when the row goes.
    return () => {
      el.onloadedmetadata = null
      el.removeAttribute('src')
    }
  }, [url, skip])
  return seconds
}

/** Returns the row for one recording of the observation. */
export function RecordingItem({ r, phone }: { r: Recording; phone: boolean }) {
  const done = r.status === 'transcribed'
  const read = useAudioSeconds(r.audioUrl, !!r.clip || !done)
  return (
    <RecordingRow
      id={'evidence-' + r.id}
      phone={phone}
      label={r.name}
      error={r.error}
      stamps={[r.correctedLabel, r.addedLabel].filter((x): x is string => !!x)}
      item={{
        // A walk clip's length is its part of the walk; a saved recording's is read from its audio.
        durationSec: r.clip ? r.clip.end - r.clip.start : read,
        status: done ? 'done' : r.status === 'transcribing' ? 'transcribing' : 'failed',
        transcript: done ? r.text : null,
        audioUrl: r.audioUrl,
      }}
      onRetry={r.retry ?? undefined}
      onRemove={r.remove ?? undefined}
      onEdit={r.canCorrect ? r.correct : undefined}
    />
  )
}
