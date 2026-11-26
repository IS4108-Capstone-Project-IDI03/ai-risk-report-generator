// Recent uploads with their ingestion status (IN-01), read from the gateway
// (the server's record, not this browser's): in progress, plus complete for 24
// hours and failed/cancelled for 7 days (the gateway decides). Re-read every 3 seconds
// while any is still queued or processing. Used by screens/AddDocuments.tsx.
import { useEffect, useState } from 'react'
import {
  Button,
  Callout,
  EmptyNote,
  EmptyState,
  HelpTip,
  ListCard,
  TableFooter,
  useIsPhone,
} from '../../../design-system'
import { plural } from '../../clients/formatClient'
import {
  cancelIngestion,
  listKnowledgeDocuments,
  retryIngestion,
  type KnowledgeDocument,
} from '../api'
import { needsReview } from '../display'
import { followList } from '../uploads'
import { Tip } from '../../help/Tip'
import { UploadedRow } from './UploadedRow'

// Re-read too whenever a new upload is accepted (refreshKey). An unreachable
// gateway leaves the last list showing.
/** Returns the Recent uploads section. */
export function UploadedDocuments({
  refreshKey,
  onCompleted,
  onLoaded,
  onReview,
}: {
  refreshKey: number
  // Opens a document's Review page from its Needs review badge (IN-07).
  onReview: (id: string) => void
  // Reports how many recent uploads finished ingesting.
  onCompleted: (count: number) => void
  // Reports the list each time it is read, so the screen knows Recent uploads has loaded (F-12).
  onLoaded?: (documents: KnowledgeDocument[]) => void
}) {
  const phone = useIsPhone()
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Documents whose retry is in flight, so the button disables and cannot
  // double-fire. A failed retry (e.g. 409 if someone beat us to it) clears the
  // flag and refreshes, which shows the document's real current status.
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [retryError, setRetryError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({})
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  // Re-reads the list (and, because a retried document is now queued, restarts
  // the 3s polling loop). Bumping `attempt` re-runs the load effect.
  const refresh = () => setAttempt((n) => n + 1)

  const retry = async (id: string) => {
    setRetrying((r) => ({ ...r, [id]: true }))
    setRetryError(null)
    try {
      await retryIngestion(id)
    } catch {
      setRetryError("Couldn't try this upload again. Check your connection, then try again.")
    } finally {
      setRetrying((r) => ({ ...r, [id]: false }))
      refresh()
    }
  }

  const cancel = async (id: string) => {
    setCancelling((c) => ({ ...c, [id]: true }))
    setCancelError(null)
    try {
      await cancelIngestion(id)
    } catch {
      setCancelError("Couldn't stop this upload. Check your connection, then try again.")
    } finally {
      setCancelling((c) => ({ ...c, [id]: false }))
      refresh()
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      listKnowledgeDocuments(controller.signal).then(
        (list) => {
          setDocuments(list)
          setUnreachable(false)
          onLoaded?.(list)
          // An upload row waiting on a type turns Uploaded once one is chosen here (IN-19).
          followList(list)
          // An upload finishing changes what the knowledge base holds, so the
          // Documents tab's count is re-read from it (IN-05).
          onCompleted(list.filter((d) => d.status === 'complete').length)
          if (list.some((d) => d.status === 'queued' || d.status === 'processing'))
            timer = setTimeout(load, 3000)
        },
        () => {
          if (!controller.signal.aborted) setUnreachable(true)
        },
      )
    void load()
    // Leaving the screen cancels the request in flight and the next re-read.
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refreshKey, attempt, onCompleted, onLoaded])

  // F-12: the first Needs review row and the first Type needed row, which two walkthrough steps point at.
  const firstReview = documents?.find((d) => d.status === 'complete' && needsReview(d))?.id
  const firstType = documents?.find((d) => d.status === 'awaiting_type')?.id

  return (
    <section className="kb-uploaded" aria-labelledby="kb-uploaded-title">
      {/* On a phone there is no table: this heading stands in for its headings (F-12). */}
      <header className="kb-uploaded-head" data-walk={phone ? 'knowledge-add.head' : undefined}>
        <h2 id="kb-uploaded-title">Recent uploads</h2>
        <HelpTip label="About recent uploads">
          <p>
            Complete uploads leave this list after 24 hours, failed or cancelled ones after 7 days.
          </p>
        </HelpTip>
        {/* The status tip (F-13): on a phone, which has no Status heading, it sits here. */}
        {phone && <Tip id="knowledge-add.status" />}
      </header>
      {retryError && (
        <Callout tone="danger" title="Retry not started">
          {retryError}
        </Callout>
      )}
      {cancelError && (
        <Callout tone="danger" title="Stop not started">
          {cancelError}
        </Callout>
      )}
      {startError && (
        <Callout tone="danger" title="Reading not started">
          {startError}
        </Callout>
      )}
      {unreachable && (
        <Callout
          tone="danger"
          title="Recent uploads not loaded"
          actions={
            <Button variant="secondary" size="sm" pill onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Can&apos;t reach the server, so these statuses may be out of date. Check your connection,
          then try again.
        </Callout>
      )}
      <ListCard>
        {documents === null ? (
          !unreachable && (
            <EmptyNote centred status>
              Loading recent uploads…
            </EmptyNote>
          )
        ) : documents.length === 0 ? (
          <EmptyState
            icon="library"
            title="No recent uploads"
            description="Documents appear here once an upload is accepted."
          />
        ) : (
          <>
            <table className="cl-table kb-uploads" aria-label="Recent uploads">
              <colgroup>
                <col />
                <col className="kb-col-when" />
                <col className="kb-col-state" />
                <col className="cl-col-actions-2" />
              </colgroup>
              <thead data-walk={phone ? undefined : 'knowledge-add.head'}>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">
                    <span className="cl-th">
                      Status
                      <Tip id="knowledge-add.status" />
                    </span>
                  </th>
                  <th scope="col">
                    <span className="kb-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d, i) => (
                  <UploadedRow
                    key={d.id}
                    document={d}
                    first={i === 0}
                    firstReview={d.id === firstReview}
                    firstType={d.id === firstType}
                    retrying={retrying[d.id]}
                    cancelling={cancelling[d.id]}
                    onRetry={() => retry(d.id)}
                    onStop={() => cancel(d.id)}
                    onReview={() => onReview(d.id)}
                    onStarted={refresh}
                    onStartError={setStartError}
                  />
                ))}
              </tbody>
            </table>
            <TableFooter>{plural(documents.length, 'upload')}</TableFooter>
          </>
        )}
      </ListCard>
    </section>
  )
}
