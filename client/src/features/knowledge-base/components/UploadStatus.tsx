// A recent upload's status (IN-01, E2): one pill, then its detail. A finished upload that needs
// review shows the Needs review pill (the way into its Review page) instead of Complete. A
// document waiting on its source type also holds the picker that starts it (IN-19).
// Used by components/UploadedRow.tsx. Calls components/ChooseSourceType.tsx.
import type { IngestionStage, IngestionStatus, KnowledgeDocument } from '../api'
import { formatDuration, needsReview } from '../display'
import { ChooseSourceType } from './ChooseSourceType'
import { ReviewBadge } from './ReviewBadge'
import { TonePill, type Tone } from './TonePill'

const STATUS: Record<IngestionStatus, { label: string; tone: Tone; icon: string }> = {
  // Waits for the admin to choose a source type before it is read (IN-19).
  awaiting_type: { label: 'Type needed', tone: 'amber', icon: 'triangle-alert' },
  // Recent uploads never lists a manual draft (IN-18); listed so every status has a label.
  draft: { label: 'Draft', tone: 'violet', icon: '' },
  queued: { label: 'Queued', tone: 'grey', icon: 'clock' },
  processing: { label: 'Processing', tone: 'blue', icon: 'loader-circle' },
  complete: { label: 'Complete', tone: 'green', icon: 'circle-check' },
  failed: { label: 'Failed', tone: 'red', icon: 'octagon-alert' },
  cancelled: { label: 'Cancelled', tone: 'grey', icon: 'circle-x' },
}

// What each stage reads as in the status pill (E2); the Status tip (tips.ts) names the same words.
const STAGE_LABELS: Record<IngestionStage, string> = {
  parsing: 'Parsing',
  anonymising: 'Anonymising',
  chunking: 'Chunking',
  indexing: 'Indexing',
  complete: 'Complete',
  failed: 'Failed',
}

// Stages that report the page reached (anonymising is too quick to need one).
const PAGE_COUNTED_STAGES: IngestionStage[] = ['parsing', 'chunking', 'indexing']

/** Returns the status cell's content for one recent upload. */
export function UploadStatus({
  document: d,
  onReview,
  onStarted,
  onStartError,
  walk,
}: {
  document: KnowledgeDocument
  onReview: () => void
  // The picker's own callbacks: the list re-reads, or shows the gateway's reason.
  onStarted: () => void
  onStartError: (reason: string | null) => void
  // Which of this row's parts the walkthrough points at (F-12).
  walk: { review?: boolean; type?: boolean }
}) {
  const badge = STATUS[d.status]
  // Progress is only shown for a processing document the worker has started.
  const p = d.status === 'processing' ? d.progress : undefined
  const stage = p && STAGE_LABELS[p.currentStage]

  // "12 / 45 pages", or "12 pages" if the total couldn't be read: while
  // parsing, the pages parsed so far (in 20-page batches), and while
  // chunking or indexing, the page reached (E2b). The chunk count has no knowable total,
  // so pages are shown instead of a progress bar.
  // Once chunking's OCR pass starts, "3 / 17 OCR" (table and formula regions
  // read) replaces the page count, which has already reached the last page.
  const pageLabel =
    p && p.currentStage === 'chunking' && p.ocrTotal != null
      ? `${p.ocrCurrent ?? 0} / ${p.ocrTotal} OCR`
      : p && PAGE_COUNTED_STAGES.includes(p.currentStage) && p.pageCurrent != null
        ? p.pageTotal
          ? `${p.pageCurrent} / ${p.pageTotal} pages`
          : `${p.pageCurrent} pages`
        : null

  return (
    <span
      className="kb-status"
      data-walk={walk.type ? 'knowledge-add.type-needed.status' : undefined}
    >
      {/* One pill: a finished upload that needs review shows the Documents list's Needs review
          pill instead of Complete (IN-05, IN-07). */}
      {d.status === 'complete' && needsReview(d) ? (
        <ReviewBadge
          title={d.title}
          onReview={onReview}
          walk={walk.review ? 'knowledge-add.needs-review' : undefined}
        />
      ) : (
        <TonePill tone={badge.tone} icon={badge.icon || undefined}>
          {stage ?? badge.label}
        </TonePill>
      )}
      {p && (
        <span className="kb-stage-detail">
          {pageLabel && <span>{pageLabel}</span>}
          <span>{formatDuration(p.elapsedMs)} elapsed</span>
        </span>
      )}
      {d.error && <span className="kb-status-reason">{d.error}</span>}
      {d.status === 'awaiting_type' && (
        <>
          <span className="kb-stage-detail">
            Its source type couldn&apos;t be read. Choose one to start.
          </span>
          <ChooseSourceType
            document={d}
            onStarted={onStarted}
            onError={onStartError}
            walk={walk.type ? 'knowledge-add.type-needed.action' : undefined}
          />
        </>
      )}
    </span>
  )
}
