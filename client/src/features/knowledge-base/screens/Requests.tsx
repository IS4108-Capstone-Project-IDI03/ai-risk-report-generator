// The knowledge base's Requests tab (CB-07): the open requests from engineers whose
// question the chatbot could not answer. Mark filled and Dismiss each open a dialog and, on
// success, the request leaves the list. Shown by KnowledgeBase.tsx; talks to api.ts.
import { useCallback, useEffect, useState } from 'react'
import { Callout, EmptyState } from '../../../design-system'
import { listKnowledgeRequests, type KnowledgeGapRequest } from '../api'
import { DismissRequestDialog } from '../components/DismissRequestDialog'
import { FillRequestDialog } from '../components/FillRequestDialog'
import { RequestRow } from '../components/RequestRow'
import { knowledgeTab } from '../openTab'

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
        {requests?.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            focused={r.id === focused}
            onFill={() => setFilling(r)}
            onDismiss={() => setDismissing(r)}
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
