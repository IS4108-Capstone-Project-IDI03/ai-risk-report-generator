// Recent uploads with their ingestion status (IN-01), read from the gateway
// (the server's record, not this browser's): in progress, plus complete for 24
// hours and failed for 7 days (the gateway decides). Re-read every 3 seconds
// while any is still queued or processing. Used by screens/AddDocuments.tsx.
import { useEffect, useState } from 'react'
import { Badge, Button, Callout, EmptyState, ProgressBar, Table } from '../../../design-system'
import {
  listKnowledgeDocuments,
  type IngestionStage,
  type IngestionStatus,
  type KnowledgeDocument,
} from '../api'
import { calendarDate, dateTime, formatDuration, SOURCE_LABELS } from '../display'

const STATUS: Record<IngestionStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  complete: { label: 'Complete', tone: 'low' },
  failed: { label: 'Failed', tone: 'critical' },
}

// What each stage reads as in the status badge (E2). OCR shares the parsing
// label with an added marker, since Docling always runs OCR within parsing.
const STAGE_LABELS: Record<IngestionStage, string> = {
  parsing: 'Parsing',
  ocr: 'Parsing · OCR',
  anonymising: 'Anonymising',
  chunking: 'Chunking',
  indexing: 'Indexing',
  complete: 'Complete',
  failed: 'Failed',
}

// Re-read too whenever a new upload is accepted (refreshKey). An unreachable
// gateway leaves the last list showing.
/** Returns the Recent uploads section. */
export function UploadedDocuments({ narrow, refreshKey }: { narrow: boolean; refreshKey: number }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      listKnowledgeDocuments(controller.signal).then(
        (list) => {
          setDocuments(list)
          setUnreachable(false)
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
  }, [refreshKey, attempt])

  const title = (d: KnowledgeDocument) => (
    <span className="kb-doc">
      <strong>{d.title}</strong>
      <small>
        {d.sourceType === 'marsh_report'
          ? `${SOURCE_LABELS[d.sourceType]} · ${d.facilityType} · ${calendarDate(d.effectiveDate)}`
          : `${d.issuingBody} · ${d.edition} Edition · ${SOURCE_LABELS[d.sourceType]}`}
      </small>
    </span>
  )
  const status = (d: KnowledgeDocument) => {
    const badge = STATUS[d.status]
    // Progress is only shown for a processing document the worker has started.
    const p = d.status === 'processing' ? d.progress : undefined
    // During parsing Docling always runs OCR, so show the OCR marker then.
    const stage =
      p && p.currentStage === 'parsing' && p.isOcr ? STAGE_LABELS.ocr : p && STAGE_LABELS[p.currentStage]

    // "42 chunks" or "42 / 100 chunks" while chunking, once any chunk is done.
    const chunkLabel =
      p && p.currentStage === 'chunking' && p.chunksCompleted > 0
        ? p.chunksTotal
          ? `${p.chunksCompleted} / ${p.chunksTotal} chunks`
          : `${p.chunksCompleted} chunks`
        : null
    // Percentage when the total is known, otherwise an indeterminate bar.
    const barValue = p?.chunksTotal ? (p.chunksCompleted / p.chunksTotal) * 100 : 0

    return (
      <span className="kb-status">
        <Badge tone={badge.tone}>{stage ?? badge.label}</Badge>
        {p && (
          <span className="kb-stage-detail">
            <span className="kb-elapsed">{formatDuration(p.elapsedMs)}</span>
            {chunkLabel && (
              <>
                <span className="kb-chunk-count">{chunkLabel}</span>
                <ProgressBar value={barValue} showValue={false} label="" style={{ width: 80 }} />
              </>
            )}
          </span>
        )}
        {d.error && <span className="kb-status-reason">{d.error}</span>}
      </span>
    )
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
        <p>Complete uploads leave this list after 24 hours, failed ones after 7 days.</p>
      </header>
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
                {original(d)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Table
          columns={[
            { key: 'document', header: 'Document' },
            { key: 'country', header: 'Country' },
            { key: 'uploaded', header: 'Uploaded' },
            { key: 'status', header: 'Status' },
            { key: 'original', header: 'Original' },
          ]}
          rows={documents.map((d) => ({
            id: d.id,
            document: title(d),
            country: d.jurisdiction === 'all' ? 'All countries' : d.jurisdiction,
            uploaded: <span className="kb-mono">{dateTime(d.uploadedAt)}</span>,
            status: status(d),
            original: original(d),
          }))}
        />
      )}
    </section>
  )
}
