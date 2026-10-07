// The Observations tab's dialogs for changing an observation (CP-08): a
// recording's transcript, and deleting it. Its tags and note are edited
// together in TagDialog.tsx. A failed save shows why and keeps what was typed
// for another try (AC18), as the knowledge base's StatusChangeDialog does.
// Opened by screens/Observations.tsx; the saves are in useAssessmentWorkflow.tsx.
import { useState } from 'react'
import { Badge, Button, Callout, Dialog, Textarea } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { useSave } from './useSave'

type Props = { v: AssessmentWorkflow; dialog: NonNullable<AssessmentWorkflow['obsDialog']> }

const quote = {
  margin: 0,
  paddingLeft: '12px',
  borderLeft: '2px solid var(--border-strong)',
  fontSize: '15px',
  lineHeight: '24px',
  color: 'var(--text-body)',
  whiteSpace: 'pre-wrap',
} as const

// Corrects a finished transcript (AC10). What Whisper wrote stays beside it,
// in the AI chrome; the correction is the engineer's own words.
export function TranscriptDialog({ v, dialog }: Props) {
  const recording = dialog.recording!
  const whisper = recording.original ?? recording.text
  const [text, setText] = useState(recording.text)
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Correct transcript"
      description={`${recording.name}. Report drafting uses your correction, and what Whisper wrote is kept.`}
      width={560}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={() => run(() => v.saveTranscript(text))}
          >
            {'Save correction'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!!problem && (
          <div role="alert">
            <Callout tone="warning" title="Correction not saved">
              {problem} Your correction is still here; press Save correction to try again.
            </Callout>
          </div>
        )}
        <section
          aria-label="What Whisper wrote"
          style={{
            background: 'var(--ai-bg)',
            border: '1px solid var(--ai-border)',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <Badge tone="ai" icon="sparkles">
            {'What Whisper wrote'}
          </Badge>
          <p style={{ ...quote, marginTop: '8px' }}>{whisper}</p>
        </section>
        <Textarea
          label="Corrected transcript"
          rows={6}
          maxLength={20000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </Dialog>
  )
}

// Confirms deleting an observation (AC12), a soft delete Show deleted can undo.
export function DeleteDialog({ v, dialog }: Props) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Delete this observation?"
      width={480}
      onClose={busy ? undefined : v.closeObsDialog}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={v.closeObsDialog}>
            {'Cancel'}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => run(v.confirmDelete)}>
            {'Delete observation'}
          </Button>
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
        {!!dialog.summary && <p style={quote}>{dialog.summary}</p>}
        <p style={{ margin: 0 }}>
          Report drafting leaves it out from now on. Drafts that cite it keep it as they were
          drafted from, and you can restore it with Show deleted.
        </p>
      </div>
    </Dialog>
  )
}
