// The knowledge base's Documents tab (KB-01, IN-05, IN-07): every document in the
// knowledge base, grouped by source type, filtered by label, status or title.
// Opening a row shows its details in a side panel (DocumentPanel); Edit details and Restore
// open one dialog over it; Withdraw and Reinstate both ask first (StatusChangeDialog).
// Shown by KnowledgeBase.tsx; talks to the gateway through api.ts.
import { useEffect, useState } from 'react'
import {
  Button,
  Callout,
  EmptyNote,
  EmptyState,
  IconRegistry,
  ListCard,
  TableFooter,
  toast,
  useIsPhone,
} from '../../../design-system'
import { plural } from '../../clients/formatClient'
import {
  listIngestedDocuments,
  publishManualDocument,
  type DocumentVersion,
  type KnowledgeDocument,
} from '../api'
import { isDraft, needsReview } from '../display'
import { CitedDeleteDialog } from '../components/CitedDeleteDialog'
import { DeleteDocumentDialog } from '../components/DeleteDocumentDialog'
import { DocumentGroup } from '../components/DocumentGroup'
import { DOCUMENT_TOASTER, DocumentPanel } from '../components/DocumentPanel'
import { DocumentToolbar } from '../components/DocumentToolbar'
import { EditDetailsDialog } from '../components/EditDetailsDialog'
import { EditHistoryDialog } from '../components/EditHistoryDialog'
import { ReviewBanner } from '../components/ReviewBanner'
import { StatusChangeDialog } from '../components/StatusChangeDialog'
import { PassagesDialog } from '../components/PassagesDialog'
import { applyFilters, NO_FILTERS, type Filters } from '../documentFilters'
import { GROUPS } from '../documentGroups'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import '../documents.css'

// The filters the admin left the list with, kept in the browser's history
// entry by KnowledgeBase.tsx so the way back from a Review page restores them.
// Merged over NO_FILTERS: an entry saved before a filter existed lacks its key.
const restoredFilters = (): Filters | null => {
  const saved = window.history.state?.kbFilters
  return saved ? { ...NO_FILTERS, ...saved } : null
}

// What the Edit details dialog opens on: the document, and the version being
// restored, if any (AC10).
type Editing = { document: KnowledgeDocument; version?: DocumentVersion }

/** Returns the Documents tab: every document in groups, with filters and details. */
export function KnowledgeDocuments({
  focused,
  notify,
  onAdd,
  onNeedReview,
  onReview,
  onClauses,
  canManage,
}: {
  // The document a notification opened (F-10), marked once and scrolled into view.
  focused?: string | null
  notify: (message: string) => void
  onAdd: () => void
  // Reports how many documents need review, for the Documents tab's count.
  onNeedReview: (count: number) => void
  // Opens a document's Review page (IN-07), keeping the filters for the way back.
  onReview: (id: string, filters: Filters) => void
  // Opens a manual document's clauses (IN-18), keeping the filters for the way back.
  onClauses: (id: string, filters: Filters) => void
  // Off for a risk engineer, who browses read-only (IN-17).
  canManage: boolean
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [filters, setFilters] = useState<Filters>(() => restoredFilters() ?? NO_FILTERS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [historyOf, setHistoryOf] = useState<KnowledgeDocument | null>(null)
  const [changingStatus, setChangingStatus] = useState<KnowledgeDocument | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null)
  const [passagesOf, setPassagesOf] = useState<KnowledgeDocument | null>(null)
  const phone = useIsPhone()
  // F-12: ready once the list has loaded; held while it is empty, since the walkthroughs point at rows.
  useWalkthroughScreen('knowledge-base', documents !== null, documents?.length === 0)

  useEffect(() => {
    const controller = new AbortController()
    listIngestedDocuments(controller.signal).then(
      (list) => {
        setDocuments(list)
        setUnreachable(false)
      },
      () => {
        if (!controller.signal.aborted) setUnreachable(true)
      },
    )
    // Leaving the screen cancels the request in flight.
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    if (documents && focused)
      window.document.getElementById(`document-${focused}`)?.scrollIntoView({ block: 'center' })
  }, [documents, focused])

  const needReview = (documents ?? []).filter(needsReview)
  const openDocument = documents?.find((d) => d.id === openId) ?? null
  // While the panel is open on a computer it covers the app's toaster (a modal dialog in the top
  // layer), so its toasts show inside it; otherwise the app's own notice.
  const say = (message: string) =>
    openDocument && !phone
      ? toast.success(message, { toasterId: DOCUMENT_TOASTER })
      : notify(message)
  // Loads and saves both change the list, so the tab's count follows it.
  useEffect(() => {
    if (documents) onNeedReview(needReview.length)
  }, [documents, needReview.length, onNeedReview])
  const filtering = Object.values(filters).some((value) => value.trim() !== '')
  const shown = applyFilters(documents ?? [], filters)
  // A changed document replaces its row in place; the gateway's list is
  // sorted by title, which a corrected title may change, so re-sort.
  const replaced = (updated: KnowledgeDocument) =>
    setDocuments((list) =>
      (list ?? [])
        .map((d) => (d.id === updated.id ? updated : d))
        .sort((a, b) => a.title.localeCompare(b.title, 'en')),
    )
  const saved = (updated: KnowledgeDocument) => {
    replaced(updated)
    setEditing(null)
    // Without this, a corrected document that no longer matches the filters
    // would just vanish, with no sign the save worked.
    say(`Details saved for ${updated.title}.`)
  }
  // Withdraw and reinstate (KB-01). The notice matters under a Status filter,
  // where the row leaves the list.
  const statusChanged = (updated: KnowledgeDocument) => {
    replaced(updated)
    setChangingStatus(null)
    say(`${updated.title} ${updated.withdrawn ? 'withdrawn' : 'reinstated'}.`)
  }
  // Delete (IN-12): the row goes at once, and its open panel with it. The list is
  // then reloaded, since a document that matched the deleted one is matched again.
  const deleted = (gone: KnowledgeDocument) => {
    setDocuments((list) => (list ?? []).filter((d) => d.id !== gone.id))
    setDeleting(null)
    setOpenId(null)
    setAttempt((n) => n + 1)
    notify(`${gone.title} deleted.`)
  }
  // Publish (IN-18): the row turns Active, or Needs review if it matched its PDF. A
  // refusal (clauses left to check or embed) says why; the draft stays as it is.
  const publish = async (draft: KnowledgeDocument) => {
    try {
      replaced(await publishManualDocument(draft.id))
      say(`${draft.title} published.`)
    } catch (error: unknown) {
      toast.error("Can't publish yet", {
        description: error instanceof Error ? error.message : 'Try again shortly.',
        toasterId: openDocument && !phone ? DOCUMENT_TOASTER : undefined,
      })
    }
  }
  // F-12: the rows the walkthroughs point at. First = the table's first row. Open = the first plain
  // active one, whose details show all four actions. Review = a Needs review one, preferring a match.
  const ordered = GROUPS.flatMap((g) => shown.filter((d) => d.sourceType === g.sourceType))
  const walk = {
    first: ordered[0]?.id,
    open: (ordered.find((d) => !d.withdrawn && !isDraft(d) && !needsReview(d)) ?? ordered[0])?.id,
    review: (needReview.find((d) => d.match) ?? needReview[0])?.id,
  }
  const clearFilters = () => setFilters(NO_FILTERS)

  return (
    <div className="kb-content">
      {unreachable && (
        <Callout
          tone="danger"
          title="Couldn't load the knowledge base"
          actions={
            <Button variant="secondary" size="sm" pill onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Can&apos;t reach the server. Check your connection, then try again.
        </Callout>
      )}

      {/* Placeholder for the app-wide notification feature (IN-05). */}
      {canManage && needReview.length > 0 && (
        <div role="status" aria-label="Documents to review" data-walk="knowledge.review-banner">
          <ReviewBanner
            documents={needReview}
            onReview={(document) => onReview(document.id, filters)}
            onShow={() => setFilters({ ...NO_FILTERS, status: 'needs_review' })}
          />
        </div>
      )}

      <ListCard as="section" label="Documents">
        <DocumentToolbar
          filters={filters}
          filtering={filtering}
          onChange={setFilters}
          onAdd={canManage ? onAdd : undefined}
        />

        {documents === null ? (
          !unreachable && (
            <EmptyNote centred status>
              Loading the knowledge base…
            </EmptyNote>
          )
        ) : filtering && shown.length === 0 ? (
          <EmptyState
            icon={IconRegistry.action.filter}
            title="No documents match"
            description="Clear a filter or choose another value to see the other documents."
            action={
              <Button variant="secondary" pill onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon="library"
            title="The knowledge base is empty"
            description="Documents appear here once an upload has been read."
            action={
              canManage ? (
                <Button variant="secondary" pill iconLeft="upload" onClick={onAdd}>
                  Add documents
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* A real table, so every header sits over its own column. */}
            <table className="cl-table kb-table" aria-label="Documents">
              <colgroup>
                <col />
                <col className="kb-col-status" />
                <col className="kb-col-actions" />
              </colgroup>
              <thead data-walk="knowledge.head">
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col" data-walk="knowledge.status.head">
                    Status
                  </th>
                  <th scope="col">
                    <span className="kb-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              {GROUPS.map((group) => {
                const rows = shown.filter((d) => d.sourceType === group.sourceType)
                // While filtering, an empty group is noise; unfiltered, it says so.
                // The Unconfirmed group exists only when it has documents.
                if ((filtering || group.sourceType === null) && rows.length === 0) return null
                return (
                  <DocumentGroup
                    key={group.sourceType ?? 'unconfirmed'}
                    group={group}
                    documents={rows}
                    openId={openId}
                    focused={focused}
                    onOpen={(document) => setOpenId(document.id)}
                    onReview={(document) => onReview(document.id, filters)}
                    canManage={canManage}
                    walk={walk}
                  />
                )
              })}
            </table>
            <TableFooter
              tone="warn"
              late={needReview.length ? `${needReview.length} need review` : undefined}
              onLateClick={() => setFilters({ ...NO_FILTERS, status: 'needs_review' })}
            >
              {filtering
                ? `${shown.length} of ${plural(documents.length, 'document')}`
                : plural(documents.length, 'document')}
            </TableFooter>
          </>
        )}
      </ListCard>

      <DocumentPanel
        document={openDocument}
        onClose={() => setOpenId(null)}
        onReview={() => openDocument && onReview(openDocument.id, filters)}
        onEdit={() => openDocument && setEditing({ document: openDocument })}
        onHistory={() => setHistoryOf(openDocument)}
        onChangeStatus={() => setChangingStatus(openDocument)}
        onDelete={() => setDeleting(openDocument)}
        onPassages={() => setPassagesOf(openDocument)}
        onPublish={() => (openDocument ? publish(openDocument) : Promise.resolve())}
        onClauses={() => openDocument && onClauses(openDocument.id, filters)}
        canManage={canManage}
      />

      {passagesOf && <PassagesDialog document={passagesOf} onClose={() => setPassagesOf(null)} />}
      {historyOf && (
        <EditHistoryDialog
          document={historyOf}
          onClose={() => setHistoryOf(null)}
          // Restoring goes through Edit details, so the admin checks first.
          onRestore={(version) => {
            setHistoryOf(null)
            setEditing({ document: historyOf, version })
          }}
        />
      )}

      {changingStatus && (
        <StatusChangeDialog
          document={changingStatus}
          onClose={() => setChangingStatus(null)}
          onChanged={statusChanged}
        />
      )}

      {deleting?.cited && (
        <CitedDeleteDialog
          document={deleting}
          onClose={() => setDeleting(null)}
          onWithdraw={() => {
            setChangingStatus(deleting)
            setDeleting(null)
          }}
        />
      )}

      {deleting && !deleting.cited && (
        <DeleteDocumentDialog
          document={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={deleted}
        />
      )}

      {editing && (
        <EditDetailsDialog
          key={editing.version?.replacedAt ?? 'current'}
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </div>
  )
}
