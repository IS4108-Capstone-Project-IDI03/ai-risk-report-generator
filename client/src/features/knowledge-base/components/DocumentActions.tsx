// A document's actions, the footer of its details panel (KB-01). Active: Edit details, Edit
// history (AC9), View passages and Withdraw. Needs review: no Edit details, since Review covers it
// (IN-07). Withdrawn: Reinstate and Edit history, but no Edit details (AC15); Reinstate is off
// while another edition is active (IN-07 AC15). Delete (IN-12) sits apart at the end. A manual
// draft (IN-18) has only Continue editing, Publish and Delete draft. Used by DocumentPanel.tsx.
import { useState } from 'react'
import { Button, IconAction, IconRegistry } from '../../../design-system'
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
  return (
    <div className="kb-actions">
      {/* A manual entry's clauses: still being entered, or amended once published (IN-18). Not
          once withdrawn: its PDF replaced it. The draft's main actions, so they keep their words. */}
      {canManage && d.entryMethod === 'manual' && !d.withdrawn && (
        <Button
          variant={draft ? 'secondary' : 'tonal'}
          size="sm"
          pill
          iconLeft={IconRegistry.action.edit}
          onClick={onClauses}
        >
          {draft ? 'Continue editing' : 'Edit clauses'}
        </Button>
      )}
      {canManage && draft && (
        <Button
          variant="primary"
          size="sm"
          pill
          iconLeft="check"
          loading={publishing}
          onClick={publish}
        >
          Publish
        </Button>
      )}
      {canManage && !draft && !d.withdrawn && !needsReview(d) && (
        <IconAction
          icon={IconRegistry.action.edit}
          label="Edit details"
          data-walk="knowledge.edit"
          onClick={onEdit}
        />
      )}
      {!draft && (
        <>
          <IconAction
            icon={IconRegistry.object.history}
            label="Edit history"
            data-walk="knowledge.history"
            onClick={onHistory}
          />
          <IconAction
            icon="list"
            label="View passages"
            data-walk="knowledge.passages"
            onClick={onPassages}
          />
        </>
      )}
      {d.fileUrl && (
        <IconAction
          icon={IconRegistry.action.openExternal}
          label={`View original of ${d.title}`}
          tooltip="View original"
          href={d.fileUrl}
        />
      )}
      {canManage && d.withdrawn && (
        <IconAction
          icon={IconRegistry.action.reinstate}
          label="Reinstate"
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
        />
      )}
      {canManage && !draft && !d.withdrawn && (
        <IconAction
          icon={IconRegistry.action.withdraw}
          label="Withdraw"
          data-walk="knowledge.withdraw"
          onClick={onChangeStatus}
        />
      )}
      {/* Last, set apart: Delete. Not while it is being read: Stop covers that. A cited document
          gets a locked Delete that explains instead (IN-12). */}
      {canManage && d.status !== 'queued' && d.status !== 'processing' && (
        <IconAction
          className="kb-delete"
          icon={d.cited ? 'lock' : IconRegistry.action.discard}
          label={d.cited ? 'Delete (cited by a report)' : draft ? 'Delete draft' : 'Delete'}
          danger={!d.cited}
          onClick={onDelete}
        />
      )}
    </div>
  )
}
