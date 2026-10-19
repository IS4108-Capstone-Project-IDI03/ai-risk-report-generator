import { Badge, Button, IconRegistry } from '../../../design-system'
import type { ReviewHistoryEntry } from '../api'
import { formatDayYearTime } from '../format'
import { historyLabel } from '../reviewDisplay'

// How many of the finding's citations an edit in the document editor deleted.
const removedCitations = (e: ReviewHistoryEntry) =>
  e.citationsAfter ? e.citations.filter((c) => !e.citationsAfter!.includes(c)).length : 0

// The section's review history (RV-02): its entries in the immutable audit
// log, newest first. An edit keeps the text before and after it (AC3), every
// entry who made the decision and when (AC4), and a rejection the finding's
// content (AC6), with Restore while it is still rejected. An edit made in the
// document editor (RV-08) also names the citations it deleted, and a finding
// deleted there reads Removed in the document.
export function ReviewHistory({
  entries,
  savedDraftId,
  rejected,
  busy,
  onRestore,
}: {
  entries: ReviewHistoryEntry[]
  // The saved draft, whose rejected findings can be restored.
  savedDraftId: string | null
  // Its findings now rejected, by key.
  rejected: Set<string>
  busy: string | null
  // Left out where the viewer may not decide.
  onRestore?: (finding: string) => void
}) {
  // Restore is offered on a finding's latest rejection only.
  const offered = new Set<string>()
  return (
    <section className="rv-panel-section" aria-label="Review history">
      <div className="rv-panel-head">
        <h3 className="rv-label">Review history</h3>
        <span className="rv-mono">{entries.length}</span>
      </div>
      {!entries.length ? (
        <p className="rv-muted">
          No decisions yet. Accepting, editing, rejecting and regenerating are recorded here, with
          who did it and when.
        </p>
      ) : (
        <ol className="rv-panel-list">
          {entries.map((e) => {
            const earlier = e.finding !== null && e.draftId !== savedDraftId
            const restorable =
              !!onRestore &&
              e.action === 'reject' &&
              !earlier &&
              rejected.has(e.finding!) &&
              !offered.has(e.finding!)
            if (restorable) offered.add(e.finding!)
            return (
              <li key={e.id} className="rv-history-item">
                <div className="rv-history-head">
                  <strong>{historyLabel(e.action, e.bulk, e.inDocument)}</strong>
                  {earlier && <Badge tone="neutral">Earlier draft</Badge>}
                </div>
                {e.heading && <p className="rv-history-where">{e.heading}</p>}
                <p className="rv-history-by">
                  {e.by.name} · {formatDayYearTime(new Date(e.at))}
                </p>
                {e.action === 'edit' && (
                  <>
                    <span className="rv-passage-label">Before</span>
                    <blockquote className="rv-passage">{e.before}</blockquote>
                    <span className="rv-passage-label">After</span>
                    <blockquote className="rv-passage">{e.after}</blockquote>
                    {removedCitations(e) > 0 && (
                      <p className="rv-muted">
                        {removedCitations(e) === 1
                          ? 'A citation was deleted, so the finding is unsupported.'
                          : `${removedCitations(e)} citations were deleted, so the finding is unsupported.`}
                      </p>
                    )}
                  </>
                )}
                {e.action === 'reject' && (
                  <>
                    <span className="rv-passage-label">
                      {e.inDocument ? 'Removed text' : 'Rejected text'}
                    </span>
                    <blockquote className="rv-passage">{e.before}</blockquote>
                  </>
                )}
                {e.action === 'regenerate' && (
                  <>
                    <span className="rv-passage-label">Instruction</span>
                    {e.instruction ? (
                      <blockquote className="rv-passage">{e.instruction}</blockquote>
                    ) : (
                      <p className="rv-muted">None given.</p>
                    )}
                  </>
                )}
                {restorable && (
                  <div className="rv-history-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={IconRegistry.action.reinstate}
                      disabled={busy !== null}
                      loading={busy === e.finding}
                      onClick={() => onRestore?.(e.finding!)}
                    >
                      Restore finding
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
