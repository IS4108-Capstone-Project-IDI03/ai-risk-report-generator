// The Voice mode of the capture screen: record or upload, the transcript, and the recordings so far (CP-02).
// Called by screens/SiteObservation.tsx.
import { Fragment } from 'react'
import { Callout, Icon } from '../../../design-system'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { DraftList } from './DraftList'
import { ReadyItem, RemoveButton } from './MediaPickers'
import '../capture.css'

export function CaptureVoicePanel({ v }: { v: AssessmentWorkflow }) {
  return (
    <>
      <div
        style={{
          background: 'var(--cap-fill)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '3px',
            height: '44px',
          }}
        >
          {v.waveBars.map((b, index) => (
            <Fragment key={index}>
              <span style={b.style}></span>
            </Fragment>
          ))}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '25px',
            lineHeight: '31px',
            fontWeight: '700',
            color: 'var(--text-primary)',
          }}
        >
          {v.fClock}
        </div>
        <button
          type="button"
          onClick={v.toggleRec}
          className={
            'cap-btn cap-btn--block ' +
            (v.recLabel.startsWith('Stop') ? 'cap-btn--danger' : 'cap-btn--primary')
          }
        >
          {v.recLabel}
        </button>
        <span
          style={{
            fontSize: '14px',
            lineHeight: '20px',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          {v.recHint}
        </span>
        {!!v.liveVoice && (
          <label
            className="ds-choice"
            style={{
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: v.recBusy ? 'var(--text-muted)' : 'var(--marsh-navy)',
              cursor: v.recBusy ? 'not-allowed' : 'pointer',
            }}
          >
            <Icon name="upload" size={16} />
            {'Upload audio files'}
            <input
              type="file"
              accept="audio/*"
              multiple
              onChange={v.uploadRecording}
              disabled={v.recBusy}
            />
          </label>
        )}
      </div>
      {!!v.fVoiceError && (
        <div role="alert">
          <Callout tone="warning" title={v.fVoiceError.title}>
            {v.fVoiceError.message}
          </Callout>
        </div>
      )}
      {!!v.hasTranscript && (
        <>
          <div
            style={{
              background: 'var(--cap-fill)',
              borderRadius: '16px',
              padding: '16px',
            }}
          >
            <p
              style={{
                margin: '0',
                fontSize: '15px',
                lineHeight: '24px',
                color: 'var(--text-body)',
              }}
            >
              {v.fTranscriptText}
            </p>
            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="cap-btn cap-btn--secondary"
                style={{ background: 'var(--surface-card)' }}
                onClick={v.transcriptToNote}
              >
                <Icon name="pencil" size={16} />
                {'Edit as text note'}
              </button>
            </div>
          </div>
        </>
      )}
      {v.fClips.length > 0 && (
        <DraftList label="Recordings">
          {v.fClips.map((clip) => (
            <ReadyItem
              key={clip.id}
              icon={clip.length ? 'mic' : 'file-audio'}
              title={clip.name}
              detail={clip.length}
            >
              <audio
                controls
                src={clip.url}
                aria-label={'Play ' + clip.name}
                style={{ height: '32px', flex: '1 1 180px', minWidth: 0 }}
              />
              <RemoveButton
                label={'Remove ' + clip.name}
                disabled={v.recBusy}
                onClick={() => v.removeClip(clip)}
              />
            </ReadyItem>
          ))}
        </DraftList>
      )}
    </>
  )
}
