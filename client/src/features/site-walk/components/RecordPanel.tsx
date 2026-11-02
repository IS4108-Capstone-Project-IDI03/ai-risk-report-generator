// The Speak side of the Recording screen (CP-22 AC2): the clock, the one-minute
// warning, why recording stopped by itself, and the controls (Camera,
// Start/Pause/Resume, Save recording). Used by screens/Recording.tsx.
import { Icon } from '../../../design-system'
import { CAP_SEC, clock } from '../recorder'
import type { Phase, StopNotice } from '../useWalkRecorder'

// Shows recording controls, elapsed time and stop warnings.
export function RecordPanel({
  phase,
  elapsed,
  notice,
  warning,
  hasRecordings,
  onStart,
  onPause,
  onResume,
  onSave,
  onCamera,
}: {
  phase: Phase
  elapsed: number
  notice: StopNotice
  warning: boolean
  hasRecordings: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onSave: () => void
  onCamera: () => void
}) {
  const running = phase !== 'idle'
  return (
    <section
      className={
        'sw-record' +
        (running ? (phase === 'paused' ? ' sw-record--paused' : ' sw-record--live') : '')
      }
      aria-label="Recording"
    >
      <div className="sw-record-state" aria-live="polite">
        {running ? (
          <span className={'sw-rec-pill' + (phase === 'paused' ? ' sw-rec-pill--paused' : '')}>
            <span className="sw-rec-dot" aria-hidden="true" />
            {phase === 'paused' ? 'Recording paused' : 'Recording'}
          </span>
        ) : (
          <span className="sw-record-idle">
            {hasRecordings ? 'Not recording' : 'Ready when you are'}
          </span>
        )}
      </div>
      <p className="sw-clock" aria-label={`${clock(elapsed)} recorded`}>
        {clock(running ? elapsed : 0)}
      </p>
      <p className="sw-note sw-clock-cap">of {clock(CAP_SEC)}</p>

      {/* Calm, not an alarm: the tone has already told them, this says what to do. */}
      {warning && (
        <p className="sw-warning" role="status">
          One minute left in this recording. Save it and start the next one when you reach a pause.
        </p>
      )}

      {notice === 'ended' && (
        <div className="sw-alert" role="alert">
          <p>
            Recording stopped, probably because the screen locked or you left the app. What you said
            up to then is kept.
          </p>
          <button type="button" className="sw-button sw-button--primary" onClick={onStart}>
            Continue recording
          </button>
        </div>
      )}

      <div className="sw-controls">
        <button type="button" className="sw-control" onClick={onCamera}>
          <span className="sw-control-icon">
            <Icon name="camera" size={22} />
          </span>
          Camera
        </button>
        {phase === 'idle' ? (
          <button
            type="button"
            className="sw-control sw-control--main sw-control--rec"
            onClick={onStart}
          >
            <span className="sw-control-icon">
              <Icon name="mic" size={28} />
            </span>
            {hasRecordings ? 'Start next recording' : 'Start recording'}
          </button>
        ) : (
          <button
            type="button"
            className="sw-control sw-control--main"
            onClick={phase === 'recording' ? onPause : onResume}
          >
            <span className="sw-control-icon">
              <Icon name={phase === 'recording' ? 'pause' : 'play'} size={28} />
            </span>
            {phase === 'recording' ? 'Pause' : 'Resume'}
          </button>
        )}
        {/* Hidden while idle but keeps its slot, so the controls don't jump. */}
        <button
          type="button"
          className={running ? 'sw-control' : 'sw-control sw-control--idle'}
          disabled={!running}
          onClick={onSave}
        >
          <span className="sw-control-icon">
            <Icon name="check" size={22} />
          </span>
          Save recording
        </button>
      </div>
    </section>
  )
}
