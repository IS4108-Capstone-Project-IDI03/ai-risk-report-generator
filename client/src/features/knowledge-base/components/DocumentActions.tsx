// A document's actions, the footer of its details panel (KB-01). Active: Edit details, Edit
// history (AC9), View passages and Withdraw. Needs review: no Edit details, since Review covers it
// (IN-07). Withdrawn: Reinstate and Edit history, but no Edit details (AC15); Reinstate is off
// while another edition is active (IN-07 AC15). Withdraw and Delete (IN-12) sit apart on their
// own row. A manual
// draft (IN-18) has only Continue editing, Publish and Delete draft. Used by DocumentPanel.tsx.
import { useState } from 'react'
import { Button, IconRegistry } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { isDraft, needsReview } from '../display'

/** Returns the document's action buttons. */
export function DocumentActions({
  document: d,
  onEdit,
  onHistory,
  onChangeStatus,
  onDelete,
  onPassages,
  onPublish,
  onClauses,
  canManage,
}: {
  document: KnowledgeDocument
  onEdit: () => void
  onHistory: () => void
  onChangeStatus: () => void
  onDelete: () => void
  // Opens the document's passages (IN-17); for everyone.
  onPassages: () => void
  // Publishes a manual draft (IN-18); settles once the gateway has answered.
  onPublish: () => Promise<void>
  // Opens a manual document's clauses (IN-18).
  onClauses: () => void
  // Off for a risk engineer: only the actions that change nothing (IN-17).
  canManage: boolean
}) {
  const draft = isDraft(d)
  const [publishing, setPublishing] = useState(false)
  const publish = () => {
    setPublishing(true)
    onPublish().finally(() => setPublishing(false))
  }
  // The risky ones (Withdraw, Delete) sit on their own row under a hairline, apart from the rest.
  const withdraw = canManage && !draft && !d.withdrawn
  const del = canManage && d.status !== 'queued' && d.status !== 'processing'
  return (
    <div className="kb-actions">
      <div className="kb-actions-main">
        {/* A manual entry's clauses: still being entered, or amended once published (IN-18). Not
            once withdrawn: its PDF replaced it. The draft's main actions, so they keep their words. */}
        {canManage && d.entryMethod === 'manual' && !d.withdrawn && (
          <Button
            variant={draft ? 'secondary' : 'tonal'}
            pill
            iconLeft={IconRegistry.action.edit}
            onClick={onClauses}
          >
            {draft ? 'Continue editing' : 'Edit clauses'}
          </Button>
        )}
        {canManage && draft && (
          <Button variant="primary" pill iconLeft="check" loading={publishing} onClick={publish}>
            Publish
          </Button>
        )}
        {canManage && !draft && !d.withdrawn && !needsReview(d) && (
          <Button
            pill
            iconLeft={IconRegistry.action.edit}
            data-walk="knowledge.edit"
            onClick={onEdit}
          >
            Edit details
          </Button>
        )}
        {!draft && (
          <>
            <Button
              pill
              iconLeft={IconRegistry.object.history}
              data-walk="knowledge.history"
              onClick={onHistory}
            >
              Edit history
            </Button>
            <Button pill iconLeft="list" data-walk="knowledge.passages" onClick={onPassages}>
              View passages
            </Button>
          </>
        )}
        {d.fileUrl && (
          <Button
            pill
            iconLeft={IconRegistry.action.openExternal}
            href={d.fileUrl}
            aria-label={`View original of ${d.title}, opens in a new tab`}
          >
            View original
          </Button>
        )}
        {canManage && d.withdrawn && (
          <Button
            pill
            iconLeft={IconRegistry.action.reinstate}
            // Off while another edition is active: two are never active at once.
            disabledReason={
              d.reinstateBlockedBy
                ? {
                    title: "Can't reinstate yet",
                    text: 'Another edition of this document is active. Withdraw it first.',
                  }
                : undefined
            }
            onClick={onChangeStatus}
          >
            Reinstate
          </Button>
        )}
      </div>
      {(withdraw || del) && (
        <div className="kb-actions-risk">
          {withdraw && (
            <Button
              pill
              iconLeft={IconRegistry.action.withdraw}
              data-walk="knowledge.withdraw"
              onClick={onChangeStatus}
            >
              Withdraw
            </Button>
          )}
          {/* Not while it is being read: Stop covers that. A cited document gets a locked Delete
              that explains instead (IN-12). */}
          {del && (
            <Button
              variant={d.cited ? 'secondary' : 'danger-outline'}
              pill
              iconLeft={d.cited ? 'lock' : IconRegistry.action.discard}
              aria-label={d.cited ? 'Delete (cited by a report)' : undefined}
              onClick={onDelete}
            >
              {draft ? 'Delete draft' : 'Delete'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
