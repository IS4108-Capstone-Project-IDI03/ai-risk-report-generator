// The review workspace's dialogs (RV-02): editing a finding, confirming its
// rejection, asking for a section to be regenerated, and confirming that a
// replacement draft takes the saved one's place; and confirming a version
// restore from the version history (RV-06). A failed save keeps the
// dialog open with the gateway's reason, as the observation dialogs do.
// Opened by screens/ReviewWorkspace.tsx, which makes the saves.
import { useState } from 'react'
import { Badge, Button, Callout, Dialog, IconRegistry, Textarea } from '../../../design-system'
import type { Claim } from '../reviewDisplay'
import { useSave } from './useSave'

// The gateway's limits (server review-decision.service).
export const MAX_FINDING_LENGTH = 2000
export const MAX_INSTRUCTION_LENGTH = 1000

const quote = {
  margin: 0,
  paddingLeft: '12px',
  borderLeft: '2px solid var(--border-strong)',
  fontFamily: 'var(--font-serif)',
  fontSize: '15px',
  lineHeight: '24px',
  color: 'var(--text-body)',
  whiteSpace: 'pre-wrap',
} as const
const column = { display: 'flex', flexDirection: 'column', gap: '12px' } as const

function Problem({ title, problem }: { title: string; problem: string | null }) {
  return problem ? (
    <div role="alert">
      <Callout tone="warning" title={title}>
        {problem}
      </Callout>
    </div>
  ) : null
}

// Edits one finding (AC2). What the draft says stays beside it in the AI
// chrome; the edit is the engineer's own wording, kept with the text before
// it in the review history (AC3).
export function EditFindingDialog({
  claim,
  onSave,
  onClose,
}: {
  claim: Claim
  onSave: (text: string) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState(claim.text)
  const { busy, problem, run } = useSave()
  const unchanged = text.trim() === claim.text
  return (
    <Dialog
      className="ds-dialog-sheet"
      title={`Edit finding ${claim.number}`}
      description={`${claim.heading}. Your wording replaces the finding's text in the draft. Its citations stay with it, and the text before and after is kept in the review history.`}
      width={600}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim() || unchanged}
            onClick={() => run(() => onSave(text.trim()))}
          >
            Save edit
          </Button>
        </>
      }
    >
      <div style={{ ...column, gap: '16px' }}>
        <Problem
          title="Edit not saved"
          problem={
            problem && `${problem} Your wording is still here; press Save edit to try again.`
          }
        />
        <section aria-label="What the draft says" className="rv-dialog-ai">
          <Badge tone="ai" icon={IconRegistry.evidence.insight}>
            What the draft says
          </Badge>
          <p style={{ ...quote, marginTop: '8px' }}>{claim.generatedText}</p>
        </section>
        <Textarea
          label="Your wording"
          rows={6}
          maxLength={MAX_FINDING_LENGTH}
          value={text}
          hint="State the finding, not an opinion or a recommendation."
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </Dialog>
  )
}

// Confirms rejecting one finding (AC5): it leaves the draft, and its content
// stays in the review history with the rejection (AC6), where Restore brings
// it back.
export function RejectFindingDialog({
  claim,
  onReject,
  onClose,
}: {
  claim: Claim
  onReject: () => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Reject this finding?"
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            iconLeft={IconRegistry.action.reject}
            loading={busy}
            onClick={() => run(onReject)}
          >
            Reject finding
          </Button>
        </>
      }
    >
      <div style={column}>
        <Problem title="Finding not rejected" problem={problem} />
        <p style={quote}>{claim.text}</p>
        <p style={{ margin: 0 }}>
          It leaves the draft and the report. Its text and citations are kept in the review history
          with your name and the time, and you can restore it from there.
        </p>
      </div>
    </Dialog>
  )
}

// Asks for a section to be regenerated (AC10), with what to change. The
// dialog closes at once: drafting takes a minute or two, and the engineer can
// keep reviewing meanwhile.
export function RegenerateDialog({
  section,
  onRegenerate,
  onClose,
}: {
  section: { id: string; title: string }
  onRegenerate: (instruction: string) => void
  onClose: () => void
}) {
  const [instruction, setInstruction] = useState('')
  return (
    <Dialog
      className="ds-dialog-sheet"
      title={`Regenerate ${section.id}. ${section.title}?`}
      description="The section is drafted again from its evidence as a replacement. The saved draft, and your decisions on it, stay the section's content until you accept the replacement. Findings you accepted or edited are kept in it word for word."
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            iconLeft={IconRegistry.action.regenerate}
            onClick={() => onRegenerate(instruction.trim())}
          >
            Regenerate section
          </Button>
        </>
      }
    >
      <Textarea
        label="What should change? (optional)"
        rows={5}
        maxLength={MAX_INSTRUCTION_LENGTH}
        value={instruction}
        hint="For example: describe the riser fire stopping in more detail. The redraft keeps what you accepted or edited where the evidence supports it, leaves out what you rejected, and still states only what the evidence supports."
        onChange={(event) => setInstruction(event.target.value)}
      />
    </Dialog>
  )
}

// Confirms that a replacement draft becomes the section's content (AC11).
export function AcceptReplacementDialog({
  section,
  onAccept,
  onClose,
}: {
  section: { id: string; title: string }
  onAccept: () => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title="Accept the replacement draft?"
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            iconLeft={IconRegistry.action.accept}
            loading={busy}
            onClick={() => run(onAccept)}
          >
            Accept replacement
          </Button>
        </>
      }
    >
      <div style={column}>
        <Problem title="Replacement not accepted" problem={problem} />
        <p style={{ margin: 0 }}>
          It becomes the content of section {section.id}, {section.title}, and each of its findings
          starts pending review. The saved draft and your decisions on it stay in the review
          history. Other sections are not changed.
        </p>
      </div>
    </Dialog>
  )
}

// Confirms restoring an earlier version of a section as its text (RV-06 AC6).
// It is saved as a new version, so the text it replaces stays in the version
// history; no other section changes (AC7).
export function RestoreVersionDialog({
  name,
  earlierDraft,
  findings,
  onRestore,
  onClose,
}: {
  // What is restored, in a sentence: "version 3", "the AI draft of 19 Oct 10:42".
  name: string
  // Written on a draft the section has been drafted again since.
  earlierDraft: boolean
  // The section has findings to review (4-12), which follow the restored text.
  findings: boolean
  onRestore: () => Promise<void>
  onClose: () => void
}) {
  const { busy, problem, run } = useSave()
  return (
    <Dialog
      title={`Restore ${name}?`}
      width={520}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            iconLeft={IconRegistry.action.reinstate}
            loading={busy}
            onClick={() => run(onRestore)}
          >
            Restore version
          </Button>
        </>
      }
    >
      <div style={column}>
        <Problem title="Version not restored" problem={problem} />
        <p style={{ margin: 0 }}>
          Its text becomes the section's current draft, saved as a new version with your name and
          the time. The text it replaces stays in the version history, so you can restore that
          again. Other sections are not changed.
        </p>
        {findings && (
          <p style={{ margin: 0 }}>
            Findings follow the restored text: one it leaves out is removed from the draft, one it
            holds that you rejected comes back, and one worded differently takes its words. Each
            change is recorded in the review history, where a removed finding can be restored.
          </p>
        )}
        {earlierDraft && (
          <p style={{ margin: 0 }}>
            It was written on an earlier draft of the section. Its findings that are in the current
            draft stay findings; the rest of its text is restored as your own.
          </p>
        )}
      </div>
    </Dialog>
  )
}
