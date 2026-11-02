// One recording on the observation page (CP-03, CP-08, CP-22): its transcript
// (as corrected), the player, and its actions. A walk clip plays only its own
// part of the walk. A failed transcription is one small line with Retry and
// an ✕ to dismiss it. Rendered by screens/ObservationPage.tsx.
import { useState } from 'react'
import { Icon } from '../../../design-system'
import type { ObservationRowView } from '../useObservationsView'

type Recording = ObservationRowView['recordings'][number]

export function RecordingItem({ r }: { r: Recording }) {
  const [dismissed, setDismissed] = useState(false)
  return (
    <section className="ob-item" id={'evidence-' + r.id} aria-label={r.name}>
      <div className="ob-item-head">
        <Icon name="mic" size={16} color="var(--ink-600)" />
        <span>{r.name}</span>
        {r.canCorrect && (
          <button type="button" className="ob-button ob-button--small" onClick={r.correct}>
            {'Edit text'}
          </button>
        )}
        {/* Kept to restore, never deleted (CP-08). */}
        {!!r.remove && (
          <button
            type="button"
            className="ob-button ob-button--small ob-icon-button ob-button--danger"
            aria-label={'Remove ' + r.name}
            title="Remove"
            onClick={r.remove}
          >
            <Icon name="trash-2" size={15} />
          </button>
        )}
      </div>
      {r.status === 'failed' ? (
        !dismissed && (
          <p className="ob-line ob-line--problem" role="status">
            <Icon name="circle-alert" size={14} />
            <span>{r.error || r.text}</span>
            <button type="button" className="ob-button ob-button--small" onClick={r.retry}>
              {'Retry'}
            </button>
            <button
              type="button"
              className="ob-button ob-button--small ob-icon-button"
              aria-label="Dismiss"
              onClick={() => setDismissed(true)}
            >
              <Icon name="x" size={14} />
            </button>
          </p>
        )
      ) : (
        // Transcribing says so once, in place of the transcript.
        <p
          className="ob-transcript"
          style={r.status === 'transcribing' ? { color: 'var(--text-secondary)' } : undefined}
        >
          {r.text}
        </p>
      )}
      <audio
        className="ob-audio"
        controls
        preload="none"
        src={r.audioUrl}
        aria-label={'Play ' + r.name}
      />
      {!!r.correctedLabel && <p className="ob-stamp">{r.correctedLabel}</p>}
      {!!r.addedLabel && <p className="ob-stamp">{r.addedLabel}</p>}
    </section>
  )
}
