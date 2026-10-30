// Asks a knowledge admin why a request is being dismissed (CB-07); the engineer reads the
// reason in their notification. Opened by screens/Requests.tsx; calls api.ts.
import { useState } from 'react'
import { Button, Callout, Dialog, Textarea } from '../../../design-system'
import { dismissKnowledgeRequest, type KnowledgeGapRequest } from '../api'
import { RequestQuote } from './RequestQuote'

/** Returns the dismiss dialog for one request. */
export function DismissRequestDialog({
  request,
  onClose,
  onDone,
  onStale,
}: {
  request: KnowledgeGapRequest
  onClose: () => void
  onDone: () => void
  // Called when another admin closed the request first, so the list can refresh.
  onStale: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await dismissKnowledgeRequest(request.id, reason.trim())
      onDone()
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Nothing was dismissed. Try again.')
      // Without this the closed request would stay in the list until a reload.
      if ((error as { status?: number }).status === 409) onStale()
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Dismiss this request?"
      description={`${request.askedBy.name} is told it was dismissed, with your reason.`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={confirm}>
            Dismiss request
          </Button>
        </>
      }
    >
      <div className="kb-request-dialog">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Not dismissed">
              {problem}
            </Callout>
          </div>
        )}
        <RequestQuote request={request} />
        <Textarea
          label="Reason for dismissing"
          placeholder="e.g. Not something we hold. Try the local fire code instead."
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Dialog>
  )
}
