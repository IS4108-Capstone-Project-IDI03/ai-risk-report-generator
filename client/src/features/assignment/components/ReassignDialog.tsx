// Reassign dialog (RV-11, boards 10 and 13): picks the engineer an assessment moves to.
// Opened from the admin Assessments list's Reassign icon; calls api.ts. On success the
// list shows the change and toasts (screens/Dashboard.tsx); on failure it stays open.
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '../../../design-system'
import { GatewayError, type Assessment } from '../../assessments/api'
import { Problem } from '../../clients/ClientDialogs'
import { useDialogSave } from '../../clients/useDialogSave'
import { reassignAssessment } from '../api'
import { useAssignableEngineers } from '../useAssignableEngineers'
import { EngineerPicker } from './EngineerPicker'

export function ReassignDialog({
  reference,
  engineer,
  me,
  onClose,
  onMoved,
  onStale,
}: {
  reference: string
  // Who holds it now: told it moved, and left out of the list.
  engineer: { id: string | null; name: string }
  me: { id: string; name: string }
  onClose: () => void
  // The assessment as the gateway answers after the move.
  onMoved: (moved: Assessment) => void
  // It was archived or moved since the list loaded: the list reads it again.
  onStale: () => void
}) {
  const { people, failed } = useAssignableEngineers(true)
  const [chosen, setChosen] = useState('')
  const [missing, setMissing] = useState(0)
  const { busy, problem, fields, run } = useDialogSave()
  const error = fields.engineerId ?? (missing && !chosen ? 'Choose an engineer' : undefined)
  // A refused press lands on the field that's missing (v2 "Forms").
  const field = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (missing) field.current?.querySelector('button')?.focus()
  }, [missing])
  const submit = () => {
    if (!chosen) return setMissing((n) => n + 1)
    void run(async () => {
      try {
        onMoved(await reassignAssessment(reference, chosen))
      } catch (e: unknown) {
        // Without this the 409 would read as a generic failure and the list would keep its stale
        // row. It means archived, or another admin moved it first (the gateway's own words).
        if (!(e instanceof GatewayError) || e.status !== 409) throw e
        onStale()
        if (!/archived/i.test(e.message)) throw e
        throw new Error(
          'This assessment was archived since you opened this page. Restore it first.',
          { cause: e },
        )
      }
    })
  }
  return (
    <Dialog
      className="ds-dialog--v2 ap-reassign"
      title={'Reassign ' + reference}
      // Nobody to tell when it had no engineer: without this it read "and Unassigned is told it moved".
      description={`Observations and drafts stay with the assessment. The new engineer gets it in their Inbox${engineer.id ? `, and ${engineer.name} is told it moved` : ''}.`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {/* The grey pill, as boards 10 and 13 draw it. */}
          <Button variant="pill" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="primary" loading={busy} onClick={submit}>
            {'Reassign'}
          </Button>
        </>
      }
    >
      <div className="ap-dialog-body">
        <Problem title="Not reassigned" problem={problem} />
        {/* Keyed by each refused press, so a repeated one shakes the field once. */}
        <div key={missing} ref={field} className={missing > 1 && !chosen ? 'ds-shake' : undefined}>
          <EngineerPicker
            inDialog
            people={people ?? []}
            me={me}
            value={chosen}
            onChange={(id) => setChosen(id)}
            error={error}
            notice={failed ? 'Couldn’t load the accounts. Close this and try again.' : undefined}
            leaveOut={engineer.id ?? undefined}
          />
        </div>
      </div>
    </Dialog>
  )
}
