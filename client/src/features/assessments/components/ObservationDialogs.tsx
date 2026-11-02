// The Observations tab's dialogs for changing an observation (CP-08): a
// recording's transcript, deleting it, and removing one of its recordings or
// photos. Its tags and note are edited in place on its page
// (screens/ObservationPage.tsx), and adding recordings and photos is AddMediaDialog.tsx. A failed save shows why and keeps what was typed
// for another try (AC18), as the knowledge base's StatusChangeDialog does.
// Opened by screens/Observations.tsx; the saves are in useAssessmentWorkflow.tsx.
import { useState } from 'react'
import { Callout, Dialog, Textarea } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useSave } from './useSave'
import '../capture.css'

type Props = { v: AssessmentWorkflow; dialog: NonNullable<AssessmentWorkflow['obsDialog']> }

// Corrects a finished transcript (AC10): only the text to edit. The gateway
// keeps what Whisper wrote, and drafting uses the correction.
export function TranscriptDialog({ v, dialog }: Props) {
  const recording = dialog.recording!
  const [text, setText] = useState(recording.text)
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit transcript"
      description={recording.name}
      width={560}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={busy}
            onClick={v.closeObsDialog}
          >
            {'Cancel'}
          </button>
          <button
            type="button"
            className="cap-btn cap-btn--primary"
            disabled={busy || !text.trim()}
            onClick={() => run(() => v.saveTranscript(text))}
          >
            {'Save'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Not saved">
              {problem}
            </Callout>
          </div>
        )}
        <Textarea
          label="Transcript"
          rows={8}
          maxLength={20000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </Dialog>
  )
}

// Confirms deleting an observation (AC12): a soft delete, so it moves to
// Deleted observations (the sidebar's Deleted) and Restore there brings it back.
// Only the Delete button is red.
export function DeleteDialog({ v }: Props) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Delete this observation?"
      width={440}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={busy}
            onClick={v.closeObsDialog}
          >
            {'Cancel'}
          </button>
          <button
            type="button"
            className="cap-btn cap-btn--danger"
            disabled={busy}
            onClick={() => run(v.confirmDelete)}
          >
            {'Delete'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Observation not deleted">
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-text">
          {
            'It moves to Deleted observations, where you can restore it. The report leaves it out until then.'
          }
        </p>
      </div>
    </Dialog>
  )
}

// Confirms removing a recording or photo from the observation (CP-08). It is
// kept, not deleted, and Restore under Removed media brings it back.
export function RemoveMediaDialog({ v, dialog }: Props) {
  const item = dialog.media!
  const noun = item.kind === 'recordings' ? 'recording' : 'photo'
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title={`Remove this ${noun}?`}
      width={480}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <button
            type="button"
            className="cap-btn cap-btn--secondary"
            disabled={busy}
            onClick={v.closeObsDialog}
          >
            {'Cancel'}
          </button>
          <button
            type="button"
            className="cap-btn cap-btn--danger"
            disabled={busy}
            onClick={() => run(v.confirmRemoveMedia)}
          >
            {`Remove ${noun}`}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title={`The ${noun} was not removed`}>
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-quote">{item.name}</p>
        <p className="cap-dialog-text">
          {(item.kind === 'recordings' ? 'The report stops using its transcript. ' : '') +
            'It moves to Removed media, where you can restore it.'}
        </p>
      </div>
    </Dialog>
  )
}
