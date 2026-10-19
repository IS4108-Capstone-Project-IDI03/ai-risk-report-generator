import { Badge, Button, Callout, Icon, IconRegistry } from '../../../design-system'
import type { TranscriptionStatus } from '../api'
import { TRANSCRIPTION_BADGE } from '../transcription'
import { PageTranscript } from './PageTranscript'

// A handwritten page as the Observations tab and the Scans view show it.
export type PageView = {
  id: string
  name: string
  url: string
  // null for a page kept in this browser by the demo, never transcribed.
  status: TranscriptionStatus | null
  transcript: string | null
  uncertain: [number, number][]
  error: string | null
  // Where it stands when there is no text to show, e.g. still transcribing.
  note: string | null
  // A failed transcription, retried by any risk engineer (CP-19 AC11).
  retry: (() => void) | null
  // A finished one, transcribed again by the assigned engineer (CP-20).
  again: (() => void) | null
}

// One photographed page of handwritten notes (CP-19): its original, which
// opens to zoom into and check the text against, and its transcript, or where
// the transcription stands. As for a recording, a failed one offers Retry; a
// finished one can be transcribed again when the text looks misread (CP-20).
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
      aria-label={p.name}
      style={
        first
          ? { marginTop: '10px' }
          : { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          fontSize: '14px',
          fontWeight: '500',
          color: 'var(--text-primary)',
        }}
      >
        <Icon
          name={IconRegistry.evidence.handwriting}
          size={14}
          color="var(--text-secondary)"
        ></Icon>
        <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{p.name}</span>
        <Badge tone="neutral">Scan</Badge>
        {p.status && (
          <Badge tone={TRANSCRIPTION_BADGE[p.status].tone}>
            {TRANSCRIPTION_BADGE[p.status].label}
          </Badge>
        )}
      </div>
      {p.status === 'failed' ? (
        <div role="status" style={{ marginTop: '8px' }}>
          <Callout
            tone="warning"
            title="Transcription failed"
            actions={
              p.retry && (
                <Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={p.retry}>
                  {'Retry transcription'}
                </Button>
              )
            }
          >
            {p.error}
          </Callout>
        </div>
      ) : p.note ? (
        <p style={{ margin: '6px 0 0', fontSize: '15px', color: 'var(--text-secondary)' }}>
          {p.note}
        </p>
      ) : (
        <PageTranscript text={p.transcript ?? ''} uncertain={p.uncertain} />
      )}
      <button
        type="button"
        aria-label={'Open ' + p.name}
        onClick={onView}
        style={{
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
      </button>
      {!!p.again && (
        <Button
          variant="secondary"
          size="sm"
          iconLeft="refresh-cw"
          onClick={p.again}
          style={{ marginTop: '8px' }}
        >
          {'Transcribe again'}
        </Button>
      )}
    </section>
  )
}
