// A document's details panel (KB-01): the design system's SidePanel from the right (a sheet on a
// phone), titled with the document, View original beside Close, its details in the body and its
// actions in the footer.
// Opened from a row of screens/KnowledgeDocuments.tsx. Calls DocumentDetails, DocumentActions.
import { useState } from 'react'
import { FileTile, IconAction, IconRegistry, SidePanel } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import { editionLine } from '../display'
import { DocumentActions } from './DocumentActions'
import { DocumentDetails } from './DocumentDetails'

// The panel's own toaster: toasts raised while it is open show inside it (SidePanel `toaster`).
export const DOCUMENT_TOASTER = 'kb-document'

type Actions = Omit<Parameters<typeof DocumentActions>[0], 'document' | 'canManage'>

/** Returns the panel for the open document; closed (after the phone sheet's exit) when none is. */
export function DocumentPanel({
  document: d,
  onClose,
  onReview,
  canManage,
  ...actions
}: Actions & {
  document: KnowledgeDocument | null
  onClose: () => void
  onReview: () => void
  canManage: boolean
}) {
  // The last document shown stays in the panel while the phone sheet slides away after closing.
  const [shown, setShown] = useState(d)
  if (d && d !== shown) setShown(d)
  const doc = d ?? shown
  if (!doc) return null
  return (
    <SidePanel
      open={!!d}
      onClose={onClose}
      title={doc.title}
      subtitle={editionLine(doc)}
      lead={<FileTile name={doc.fileName ?? undefined} kind={doc.fileName ? undefined : 'text'} />}
      toaster={DOCUMENT_TOASTER}
      closeWalk="knowledge.details-close"
      // A manual entry has no file to open (IN-18).
      tools={
        doc.fileUrl && (
          <IconAction
            icon={IconRegistry.action.openExternal}
            label={`View original of ${doc.title}`}
            tooltip="View original"
            placement="bottom"
            size="md"
            href={doc.fileUrl}
          />
        )
      }
      footer={<DocumentActions document={doc} canManage={canManage} {...actions} />}
    >
      <DocumentDetails document={doc} onReview={onReview} canManage={canManage} />
    </SidePanel>
  )
}
