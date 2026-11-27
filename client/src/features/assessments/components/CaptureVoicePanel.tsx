// The Voice tab of New Observation: record or upload, and the recordings so far (CP-02, CP-24).
// A recording starts transcribing as soon as it is added, and its row shows its first words once
// it has them; the chevron opens the whole transcript. Called by screens/SiteObservation.tsx.
import { Fragment, useEffect, useRef } from 'react'
import { Button, Callout } from '../../../design-system'
import { RecordingRow } from '../../site-walk/components/RecordingRow'
import { signal } from '../../walkthrough/signals'
import { type AssessmentWorkflow } from '../useAssessmentWorkflow'
import { CaptureFilePicker } from './CaptureFilePicker'
import '../../site-walk/site-walk.css'
import '../../site-walk/walkList.css'
import '../capture.css'

export function CaptureVoicePanel({ v }: { v: AssessmentWorkflow }) {
  const recording = v.recLabel.startsWith('Stop')
  // F-12: a recording joining the list means one has stopped and been kept. The "Add an observation"
  // walkthrough waits on this; the count at first showing is the baseline, so only a new one counts.
  const clips = useRef(v.captureRows.length)
  useEffect(() => {
    if (v.captureRows.length > clips.current) signal('observation-recording-stopped')
    clips.current = v.captureRows.length
  }, [v.captureRows.length])
  return (
    <>
      <div className="cap-rec">
        <div className="cap-rec-bars" aria-hidden="true">
          {v.waveBars.map((b, index) => (
            <Fragment key={index}>
              <span style={b.style}></span>
            </Fragment>
          ))}
        </div>
        <div className="cap-rec-clock">{v.fClock}</div>
        {/* A white pill on the grey box, not navy: Save observation is the screen's one main action. */}
        <Button
          pill
          variant={recording ? 'danger' : 'secondary'}
          iconLeft={recording ? 'square' : 'mic'}
          fullWidth
          disabled={v.recBusy && !recording}
          data-walk="new-observation.record"
          onClick={v.toggleRec}
        >
          {v.recLabel}
        </Button>
        {!!v.liveVoice && (
          <CaptureFilePicker
            tone="link"
            icon="upload"
            label="Upload audio files"
            accept="audio/*"
            multiple
            disabled={v.recBusy}
            onChange={v.uploadRecording}
          />
        )}
      </div>
      {!!v.fVoiceError && (
        <div role="alert">
          <Callout tone="warning" title={v.fVoiceError.title}>
            {v.fVoiceError.message}
          </Callout>
        </div>
      )}
      {v.captureRows.length > 0 && (
        <ul
          className="sw-list cap-clips"
          aria-label="Recordings"
          data-walk="new-observation.recordings"
        >
          {v.captureRows.map((row) => (
            <RecordingRow
              key={row.key}
              item={row.item}
              phone={v.phone}
              onRetry={row.onRetry}
              onRemove={row.onRemove}
            />
          ))}
        </ul>
      )}
    </>
  )
}
