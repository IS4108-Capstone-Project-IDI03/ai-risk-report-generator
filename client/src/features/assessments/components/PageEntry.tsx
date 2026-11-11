import { Icon, IconRegistry } from '../../../design-system'
import type { ObservationPage } from '../types'
import { PageTranscript } from './PageTranscript'
import { ZoomBadge } from './ZoomBadge'

// A handwritten page as the Observations tab and the Scans view show it.
export type PageView = ObservationPage & {
  // Where it stands when there is no text to show, e.g. still transcribing.
  note: string | null
  // A failed transcription, retried by any risk engineer (CP-19 AC11).
  retry: (() => void) | null
  // A finished one, transcribed again by the assigned engineer (CP-20); for
  // a corrected one, this asks first, as the correction goes.
  again: (() => void) | null
  // Its text corrected, or written for a demo page, and the page removed,
  // by whoever may change the observation (CP-20).
  correct: (() => void) | null
  remove: (() => void) | null
  correctedLabel: string | null
  addedLabel: string | null
}

// One photographed page of handwritten notes (CP-19): its original, which
// opens to zoom into and check the text against, and its transcript, or where
// the transcription stands. As for a recording, a failed one offers Retry; a
// finished one can be transcribed again when the text looks misread, or its
// text corrected, and the page removed (CP-20). A corrected page shows the
// engineer's text as theirs, without the AI rule or uncertain marks, which
// stay with what the model wrote, folded away beneath it.
export function PageEntry({
  page: p,
  first = true,
  onView,
}: {
  page: PageView
  first?: boolean
  onView: () => void
}) {
  return (
    <section
      id={'evidence-' + p.id}
      aria-label={p.name}
      style={
        first
          ? { marginTop: '10px' }
          : { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }
      }
    >
      <div className="ob-item-head">
        <Icon name={IconRegistry.evidence.handwriting} size={14} color="var(--text-secondary)" />
        <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{p.name}</span>
        {!!p.correct && (
          // A pencil beside the bin, both icon-only, as a recording's are.
          <button
            type="button"
            className="ob-button ob-button--small ob-icon-button"
            aria-label={'Edit text of ' + p.name}
            title="Edit text"
            onClick={p.correct}
          >
            <Icon name="pencil" size={15} />
          </button>
        )}
        {/* Kept to restore, never deleted (CP-20). */}
        {!!p.remove && (
          <button
            type="button"
            className="ob-button ob-button--small ob-icon-button ob-button--danger"
            aria-label={'Remove ' + p.name}
            title="Remove"
            onClick={p.remove}
          >
            <Icon name="trash-2" size={15} />
          </button>
        )}
      </div>
      {p.status === 'failed' ? (
        // One small line: what went wrong, and Retry (CP-22).
        <p
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '4px 8px',
            margin: '6px 0 0',
            fontSize: '13px',
            color: 'var(--red-600)',
          }}
        >
          <Icon name="circle-alert" size={14} />
          <span style={{ flex: '1 1 180px' }}>{p.error}</span>
          {p.retry && (
            <button type="button" className="ob-button ob-button--small" onClick={p.retry}>
              <Icon name="refresh-cw" size={13} />
              {'Retry'}
            </button>
          )}
        </p>
      ) : p.note ? (
        <p style={{ margin: '6px 0 0', fontSize: '15px', color: 'var(--text-secondary)' }}>
          {p.note}
        </p>
      ) : p.correction ? (
        <>
          <p className="ob-transcript" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
            {p.transcript}
          </p>
          {p.original !== null && (
            <details style={{ marginTop: '6px' }}>
              <summary
                style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}
              >
                {'As transcribed'}
              </summary>
              {p.original.trim() ? (
                <PageTranscript text={p.original} uncertain={p.uncertain} />
              ) : (
                <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  {'No handwriting was found on this page.'}
                </p>
              )}
            </details>
          )}
        </>
      ) : (
        <PageTranscript text={p.transcript ?? ''} uncertain={p.uncertain} />
      )}
      <button
        type="button"
        aria-label={'Open ' + p.name}
        onClick={onView}
        style={{
          position: 'relative',
          display: 'block',
          width: '132px',
          marginTop: '8px',
          padding: 0,
          border: '1px solid var(--border-default)',
          borderRadius: '5px',
          background: 'var(--surface-card)',
          overflow: 'hidden',
          cursor: 'zoom-in',
        }}
      >
        <img
          src={p.url}
          alt=""
          loading="lazy"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        <ZoomBadge />
      </button>
      {!!p.again && (
        <button
          type="button"
          className="ob-button ob-button--tinted ob-button--small"
          onClick={p.again}
          style={{ marginTop: '8px' }}
        >
          <Icon name="refresh-cw" size={13} />
          {'Transcribe again'}
        </button>
      )}
      {!!p.correctedLabel && <p className="ob-stamp">{p.correctedLabel}</p>}
      {!!p.addedLabel && <p className="ob-stamp">{p.addedLabel}</p>}
    </section>
  )
}
