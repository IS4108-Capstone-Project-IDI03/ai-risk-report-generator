// The knowledge base's Requests tab (CB-07): the open requests from engineers whose
// question the chatbot could not answer. Mark filled and Dismiss each open a dialog and, on
// success, the request leaves the list. Shown by KnowledgeBase.tsx; talks to api.ts.
import { useCallback, useEffect, useState } from 'react'
import { Callout, EmptyState, toast } from '../../../design-system'
import { listKnowledgeRequests, uploadKnowledgeDocument, type KnowledgeGapRequest } from '../api'
import { DismissRequestDialog } from '../components/DismissRequestDialog'
import { FillRequestDialog } from '../components/FillRequestDialog'
import { RequestRow } from '../components/RequestRow'
import { knowledgeTab } from '../openTab'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'

/** Returns the Requests tab: the open requests, newest first. */
export function Requests({
  notify,
  onCount,
}: {
  notify: (message: string) => void
  // Reports how many requests are open, for the tab's count.
  onCount: (count: number) => void
}) {
  const [requests, setRequests] = useState<KnowledgeGapRequest[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [filling, setFilling] = useState<KnowledgeGapRequest | null>(null)
  const [dismissing, setDismissing] = useState<KnowledgeGapRequest | null>(null)
  // F-12: ready once the list has loaded; held while no request is open, since nothing is shown then.
  useWalkthroughScreen('knowledge-requests', requests !== null, requests?.length === 0)
  // The request a notification pointed at; read once so a later visit isn't highlighted.
  const [focused] = useState(() => {
    const id = knowledgeTab.request
    knowledgeTab.request = null
    return id
  })

  const load = useCallback((signal?: AbortSignal) => {
    listKnowledgeRequests(signal).then(
      (list) => {
        setRequests(list)
        setUnreachable(false)
      },
      () => !signal?.aborted && setUnreachable(true),
    )
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])
  useEffect(() => {
    if (requests) onCount(requests.length)
  }, [requests, onCount])
  // Brings the highlighted request into view once the list has loaded.
  useEffect(() => {
    if (requests && focused)
      document.getElementById(`request-${focused}`)?.scrollIntoView({ block: 'center' })
  }, [requests, focused])

  // A document uploaded for a request (F-11): the request stays open until it is marked filled.
  const upload = (r: KnowledgeGapRequest, file: File) =>
    uploadKnowledgeDocument(file, undefined, r.id).then(
      () => notify(`${file.name} is uploading for this request. ${r.askedBy.name} can follow it.`),
      (error: unknown) =>
        toast.error(`${file.name} was not uploaded`, {
          description: error instanceof Error && error.message ? error.message : undefined,
        }),
    )

  const done = (message: string) => {
    setFilling(null)
    setDismissing(null)
    load()
    notify(message)
  }

  return (
    <section className="kb-requests kb-docs" aria-labelledby="kb-requests-title">
      <header className="kb-docs-head">
        <h2 id="kb-requests-title">Open requests</h2>
        <p>
          Questions the chatbot couldn&apos;t answer. Add the document, then mark the request
          filled.
        </p>
      </header>
      {unreachable && (
        <div role="alert">
          <Callout tone="warning" title="Requests could not be loaded">
            The gateway could not be reached. Reopen the tab to try again.
          </Callout>
        </div>
      )}
      {requests?.length === 0 && (
        <EmptyState
          title="No open requests"
          description="When an engineer asks for a document, it appears here."
        />
      )}
      <ul className="kb-request-list">
        {requests?.map((r, i) => (
          <RequestRow
            key={r.id}
            first={i === 0}
            request={r}
            focused={r.id === focused}
            onFill={() => setFilling(r)}
            onDismiss={() => setDismissing(r)}
            onUpload={(file) => upload(r, file)}
          />
        ))}
      </ul>
      {filling && (
        <FillRequestDialog
          request={filling}
          onClose={() => setFilling(null)}
          onDone={() => done('Request marked as filled')}
          onStale={load}
        />
      )}
      {dismissing && (
        <DismissRequestDialog
          request={dismissing}
          onClose={() => setDismissing(null)}
          onDone={() => done('Request dismissed')}
          onStale={load}
        />
      )}
    </section>
  )
}
