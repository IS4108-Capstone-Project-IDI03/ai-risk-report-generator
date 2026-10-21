// Lets a knowledge admin pick the documents that fill a request (CB-07), newest upload
// first, so the engineer is told exactly what was added. Opened by screens/Requests.tsx;
// reads the document list and calls api.ts.
import { useEffect, useState } from 'react'
import { Button, Callout, Checkbox, Dialog } from '../../../design-system'
import {
  fillKnowledgeRequest,
  listIngestedDocuments,
  type KnowledgeDocument,
  type KnowledgeGapRequest,
} from '../api'
import { calendarDate, needsReview } from '../display'
import { RequestQuote } from './RequestQuote'

// e.g. "21 Oct 2026 10:18": the design system's literal date with its year, then the time.
const uploadedWhen = (iso: string) =>
  `${calendarDate(iso)} ${new Date(iso).toTimeString().slice(0, 5)}`

/** Returns the mark-as-filled dialog for one request. */
export function FillRequestDialog({
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
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listIngestedDocuments(controller.signal).then(
      (list) =>
        // Active only (same rule as the Documents tab's Active filter), newest upload first.
        setDocuments(
          list
            .filter((d) => !d.withdrawn && !needsReview(d))
            .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
        ),
      () => !controller.signal.aborted && setProblem('The documents could not be loaded.'),
    )
    return () => controller.abort()
  }, [])

  const toggle = (id: string, on: boolean) =>
    setPicked((now) => (on ? [...now, id] : now.filter((x) => x !== id)))

  const confirm = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await fillKnowledgeRequest(request.id, picked)
      onDone()
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Nothing was saved. Try again.')
      // Without this the closed request would stay in the list until a reload.
      if ((error as { status?: number }).status === 409) onStale()
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Mark as filled"
      description={`Pick the documents you added. ${request.askedBy.name} is told each one's title and upload time.`}
      width={560}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!picked.length} onClick={confirm}>
            Mark as filled
          </Button>
        </>
      }
    >
      <div className="kb-request-dialog">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Not marked as filled">
              {problem}
            </Callout>
          </div>
        )}
        <RequestQuote request={request} />
        {documents?.length === 0 && <p>There are no active documents yet. Add one first.</p>}
        {/* Scrolls on its own: without it, a long list pushed the confirm button off screen. */}
        <div className="kb-request-picker">
          {documents?.map((d) => (
            <Checkbox
              key={d.id}
              label={d.title}
              // Date and time only: the time is what tells an admin "that's the one I just added".
              description={<span className="kb-mono">{uploadedWhen(d.uploadedAt)}</span>}
              checked={picked.includes(d.id)}
              onChange={(on) => toggle(d.id, on)}
            />
          ))}
        </div>
      </div>
    </Dialog>
  )
}
