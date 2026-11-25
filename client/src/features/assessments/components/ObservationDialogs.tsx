// The Observations tab's dialogs for changing an observation (CP-08): a
// recording's transcript, deleting it, and removing one of its recordings,
// photos or handwritten pages; a page's text, and transcribing a corrected
// page again (CP-20). Its tags and note are edited in place on its page
// (screens/ObservationPage.tsx), and adding recordings and photos is AddMediaDialog.tsx. A failed save shows why and keeps what was typed
// for another try (AC18), as the knowledge base's StatusChangeDialog does.
// Opened by screens/Observations.tsx; the saves are in useAssessmentWorkflow.tsx.
import { useRef, useState } from 'react'
import { Button, Callout, Dialog, Textarea } from '../../../design-system'
import { DictateButton } from '../dictation/DictateButton'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useSave } from './useSave'
import '../capture.css'

type Props = { v: AssessmentWorkflow; dialog: NonNullable<AssessmentWorkflow['obsDialog']> }

// Corrects a finished transcript (AC10): only the text to edit. The gateway
// keeps what Whisper wrote, and drafting uses the correction. It can be
// dictated (CP-27), as when the engineer says again what the recording missed.
export function TranscriptDialog({ v, dialog }: Props) {
  const recording = dialog.recording!
  const [text, setText] = useState(recording.text)
  const { busy, problem, run } = useSave()
  // Holds the text box, for dictation to find: the shared Textarea takes no ref.
  const box = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit transcript"
      description={recording.name}
      width={560}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="pill" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button
            pill
            variant="primary"
            disabled={busy || !text.trim()}
            onClick={() => run(() => v.saveTranscript(text))}
          >
            {'Save'}
          </Button>
        </>
      }
    >
      <div className="cap-stack cap-stack--roomy">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Not saved">
              {problem}
            </Callout>
          </div>
        )}
        <div ref={box}>
          <Textarea
            label="Transcript"
            rows={8}
            maxLength={20000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {v.liveReference && (
          <DictateButton
            reference={v.liveReference}
            field={() => box.current?.querySelector('textarea')}
            onChange={setText}
          />
        )}
      </div>
    </Dialog>
  )
}

// Corrects a handwritten page's text (CP-20). The gateway keeps what the model wrote, and
// drafting uses the correction. The page's photo is shown to check against.
export function PageTextDialog({ v, dialog }: Props) {
  const page = dialog.page!
  const [text, setText] = useState(page.transcript ?? '')
  const { busy, problem, run } = useSave()
  // Holds the text box, for dictation to find (CP-27): reading the page aloud fixes it.
  const box = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit page text"
      description={page.name}
      width={640}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="pill" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button
            pill
            variant="primary"
            disabled={busy || !text.trim()}
            onClick={() => run(() => v.savePageText(text))}
          >
            {'Save'}
          </Button>
        </>
      }
    >
      <div className="cap-stack cap-stack--roomy">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Not saved">
              {problem}
            </Callout>
          </div>
        )}
        <img
          src={page.url}
          alt={'Photo of ' + page.name}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: '320px',
            objectFit: 'contain',
            border: '1px solid var(--border-default)',
            borderRadius: '5px',
          }}
        />
        <div ref={box}>
          <Textarea
            label="Page text"
            rows={8}
            maxLength={20000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {v.liveReference && (
          <DictateButton
            reference={v.liveReference}
            field={() => box.current?.querySelector('textarea')}
            onChange={setText}
          />
        )}
        {page.status !== null && (
          <p className="cap-dialog-text">
            {'What was transcribed is kept beside your text. The report uses your text.'}
          </p>
        )}
      </div>
    </Dialog>
  )
}

// Confirms transcribing a corrected page again (CP-20): the new transcription
// replaces the engineer's corrected text, which is not kept.
export function TranscribeAgainDialog({ v, dialog }: Props) {
  const page = dialog.page!
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Transcribe this page again?"
      width={480}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="pill" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button
            pill
            variant="primary"
            disabled={busy}
            onClick={() => run(v.confirmTranscribeAgain)}
          >
            {'Transcribe again'}
          </Button>
        </>
      }
    >
      <div className="cap-stack">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Not transcribed again">
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-quote">{page.name}</p>
        <p className="cap-dialog-text">
          {
            'Your corrected text is replaced by the new transcription and is not kept. Copy it first if you want it.'
          }
        </p>
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
          <Button variant="pill" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" disabled={busy} onClick={() => run(v.confirmDelete)}>
            {'Delete'}
          </Button>
        </>
      }
    >
      <div className="cap-stack">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Observation not deleted">
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-text">
          {
            'It moves to Deleted Observations, where you can restore it. The report leaves it out until then.'
          }
        </p>
      </div>
    </Dialog>
  )
}

// Confirms removing a recording, photo or handwritten page from the
// observation (CP-08, CP-20). It is kept, not deleted, and Restore under
// Removed media brings it back.
export function RemoveMediaDialog({ v, dialog }: Props) {
  const item = dialog.media!
  const noun = { recordings: 'recording', photos: 'photo', pages: 'page' }[item.kind]
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title={`Remove this ${noun}?`}
      width={480}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="pill" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" disabled={busy} onClick={() => run(v.confirmRemoveMedia)}>
            {`Remove ${noun}`}
          </Button>
        </>
      }
    >
      <div className="cap-stack">
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title={`The ${noun} was not removed`}>
              {problem}
            </Callout>
          </div>
        )}
        <p className="cap-dialog-quote">{item.name}</p>
        <p className="cap-dialog-text">
          {{
            recordings: 'The report stops using its transcript. ',
            photos: '',
            pages: 'The report stops using its text. ',
          }[item.kind] + 'It moves to Removed media, where you can restore it.'}
        </p>
      </div>
    </Dialog>
  )
}
