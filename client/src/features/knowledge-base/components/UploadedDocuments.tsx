// Recent uploads with their ingestion status (IN-01), read from the gateway
// (the server's record, not this browser's): in progress, plus complete for 24
// hours and failed/cancelled for 7 days (the gateway decides). Re-read every 3 seconds
// while any is still queued or processing. Used by screens/AddDocuments.tsx.
import { useEffect, useState } from 'react'
import { Badge, Button, Callout, EmptyState, Table } from '../../../design-system'
import {
  cancelIngestion,
  listKnowledgeDocuments,
  retryIngestion,
  type IngestionStage,
  type IngestionStatus,
  type KnowledgeDocument,
} from '../api'
import {
  calendarDate,
  dateTime,
  facilityName,
  formatDuration,
  needsReview,
  reviewReasons,
  SOURCE_LABELS,
} from '../display'
import { ReviewBadge } from './ReviewBadge'

const STATUS: Record<IngestionStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  complete: { label: 'Complete', tone: 'low' },
  failed: { label: 'Failed', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

// What each stage reads as in the status badge (E2).
const STAGE_LABELS: Record<IngestionStage, string> = {
  parsing: 'Parsing',
  anonymising: 'Anonymising',
  chunking: 'Chunking',
  indexing: 'Indexing',
  complete: 'Complete',
  failed: 'Failed',
}

// Re-read too whenever a new upload is accepted (refreshKey). An unreachable
// gateway leaves the last list showing.
/** Returns the Recent uploads section. */
export function UploadedDocuments({
  narrow,
  refreshKey,
  onCompleted,
  onReview,
}: {
  narrow: boolean
  refreshKey: number
  // Opens a document's Review page from its Needs review badge (IN-07).
  onReview: (id: string) => void
  // Reports how many recent uploads finished ingesting.
  onCompleted: (count: number) => void
}) {
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

  // Re-reads the list (and, because a retried document is now queued, restarts
  // the 3s polling loop). Bumping `attempt` re-runs the load effect.
  const refresh = () => setAttempt((n) => n + 1)

  const retry = async (id: string) => {
    setRetrying((r) => ({ ...r, [id]: true }))
    setRetryError(null)
    try {
      await retryIngestion(id)
    } catch {
      setRetryError('The retry could not be started. Check the connection, then try again.')
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
      setCancelError('The stop request could not be sent. Check the connection, then try again.')
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
  }, [refreshKey, attempt, onCompleted])

  const title = (d: KnowledgeDocument) => (
    <span className="kb-doc">
      <strong>{d.title}</strong>
      <small>
        {d.sourceType === 'marsh_report'
          ? `${SOURCE_LABELS[d.sourceType]} · ${facilityName(d.facilityType)} · ${calendarDate(d.effectiveDate)}`
          : [
              // "NFPA 13" once the standard number is known (IN-07).
              [d.issuingBody, d.standardNumber].filter(Boolean).join(' '),
              d.edition && `${d.edition} Edition`,
              d.sourceType ? SOURCE_LABELS[d.sourceType] : 'Source type unconfirmed',
            ]
              .filter(Boolean)
              .join(' · ')}
      </small>
      {/* Why it needs review, under the title as in the Documents list (IN-07). */}
      {d.status === 'complete' && needsReview(d) && (
        <small className="kb-why">{reviewReasons(d).join(' · ')}</small>
      )}
    </span>
  )
  const status = (d: KnowledgeDocument) => {
    const badge = STATUS[d.status]
    // Progress is only shown for a processing document the worker has started.
    const p = d.status === 'processing' ? d.progress : undefined
    const stage = p && STAGE_LABELS[p.currentStage]

    // "12 / 45 pages", or "12 pages" if the total couldn't be read, while
    // chunking once a page with provenance is reached (E2b). The chunk count
    // has no knowable total, so pages are shown instead of a progress bar.
    const pageLabel =
      p && p.currentStage === 'chunking' && p.pageCurrent
        ? p.pageTotal
          ? `${p.pageCurrent} / ${p.pageTotal} pages`
          : `${p.pageCurrent} pages`
        : null

    return (
      <span className="kb-status">
        <span className="kb-status-line">
          {/* One badge: a finished upload that needs review shows the Documents
              list's Needs review badge instead of Complete (IN-05, IN-07). */}
          {d.status === 'complete' && needsReview(d) ? (
            <ReviewBadge title={d.title} onReview={() => onReview(d.id)} />
          ) : (
            <Badge tone={badge.tone}>{stage ?? badge.label}</Badge>
          )}
        </span>
        {p && (
          <span className="kb-stage-detail">
            {pageLabel && <span className="kb-page-count">{pageLabel}</span>}
            <span className="kb-elapsed">{formatDuration(p.elapsedMs)} elapsed</span>
          </span>
        )}
        {d.error && <span className="kb-status-reason">{d.error}</span>}
      </span>
    )
  }
  const action = (d: KnowledgeDocument) => {
    if (d.status === 'failed' || d.status === 'cancelled') {
      return (
        <Button
          variant="secondary"
          size="sm"
          iconLeft="refresh-cw"
          disabled={retrying[d.id]}
          onClick={() => retry(d.id)}
        >
          {retrying[d.id] ? 'Retrying…' : 'Retry'}
        </Button>
      )
    }
    if (d.status === 'queued' || d.status === 'processing') {
      return (
        <Button
          variant="danger-tonal"
          size="sm"
          iconLeft="x"
          disabled={cancelling[d.id]}
          onClick={() => cancel(d.id)}
        >
          {cancelling[d.id] ? 'Stopping…' : 'Stop'}
        </Button>
      )
    }
    return null
  }
  const original = (d: KnowledgeDocument) => (
    <a
      className="kb-link"
      href={d.fileUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`View original of ${d.title}`}
    >
      View original
    </a>
  )

  return (
    <section className="kb-uploaded" aria-labelledby="kb-uploaded-title">
      <header className="kb-uploaded-head">
        <h2 id="kb-uploaded-title">Recent uploads</h2>
        <p>
          Complete uploads leave this list after 24 hours, failed or cancelled ones after 7 days.
        </p>
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
      {unreachable && (
        <Callout
          tone="danger"
          title="Recent uploads not loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          The gateway could not be reached, so ingestion status is not up to date. Check that the
          server is running, then try again.
        </Callout>
      )}
      {documents === null ? (
        !unreachable && (
          <p className="kb-empty" role="status">
            Loading recent uploads…
          </p>
        )
      ) : documents.length === 0 ? (
        <EmptyState
          icon="library"
          title="No recent uploads"
          description="Documents appear here once an upload is accepted, with their ingestion status."
        />
      ) : narrow ? (
        <ul className="kb-stack" aria-label="Recent uploads">
          {documents.map((d) => (
            <li key={d.id}>
              {title(d)}
              {status(d)}
              <span className="kb-stack-meta">
                <span className="kb-mono">{dateTime(d.uploadedAt)}</span>
                <span className="kb-stack-actions">
                  {action(d)}
                  {original(d)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Table
          columns={[
            { key: 'document', header: 'Document' },
            { key: 'uploaded', header: 'Uploaded' },
            { key: 'status', header: 'Status' },
            { key: 'action', header: 'Action', align: 'right' },
            { key: 'original', header: 'Original' },
          ]}
          rows={documents.map((d) => ({
            id: d.id,
            document: title(d),
            uploaded: <span className="kb-mono">{dateTime(d.uploadedAt)}</span>,
            status: status(d),
            action: action(d),
            original: original(d),
          }))}
        />
      )}
    </section>
  )
}
