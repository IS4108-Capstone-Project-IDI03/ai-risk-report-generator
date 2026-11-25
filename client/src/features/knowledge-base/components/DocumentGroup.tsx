// One source type's documents in the Documents table (KB-01): a band with
// its name and count, then its rows. Used by screens/KnowledgeDocuments.tsx;
// renders components/DocumentRow.tsx.
import { CountPill, Icon } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import type { Group } from '../documentGroups'
import { DocumentRow } from './DocumentRow'

/** Returns one group's rows as a table body. */
export function DocumentGroup({
  group,
  documents,
  openId,
  focused,
  onToggle,
  onEdit,
  onHistory,
  onChangeStatus,
  onDelete,
  onReview,
  onPassages,
  onPublish,
  onClauses,
  canManage,
  walk,
}: {
  group: Group
  documents: KnowledgeDocument[]
  openId: string | null
  focused?: string | null
  onToggle: (id: string) => void
  onEdit: (document: KnowledgeDocument) => void
  onHistory: (document: KnowledgeDocument) => void
  onChangeStatus: (document: KnowledgeDocument) => void
  onDelete: (document: KnowledgeDocument) => void
  onReview: (document: KnowledgeDocument) => void
  onPassages: (document: KnowledgeDocument) => void
  // Publishes a manual draft (IN-18); settles once the gateway has answered.
  onPublish: (document: KnowledgeDocument) => Promise<void>
  // Opens a manual document's clauses (IN-18).
  onClauses: (document: KnowledgeDocument) => void
  // Off for a risk engineer, who browses read-only (IN-17).
  canManage: boolean
  // The ids of the rows the walkthroughs point at (F-12), see KnowledgeDocuments.tsx.
  walk?: { first?: string; open?: string; review?: string }
}) {
  const id = `kb-group-${group.sourceType ?? 'unconfirmed'}`
  return (
    <tbody aria-labelledby={id}>
      <tr className="kb-band">
        <th colSpan={4} scope="colgroup">
          <span className="kb-band-inner">
            <Icon name={group.icon} size={16} />
            <span id={id}>{group.title}</span>
            <CountPill>{documents.length}</CountPill>
          </span>
        </th>
      </tr>
      {documents.length === 0 ? (
        <tr>
          <td colSpan={4} className="kb-list-note">
            No {group.title.replace(/^(Past|Local) /, (word) => word.toLowerCase())} yet.
          </td>
        </tr>
      ) : (
        documents.map((d) => (
          <DocumentRow
            key={d.id}
            document={d}
            open={openId === d.id}
            focused={d.id === focused}
            onToggle={() => onToggle(d.id)}
            onEdit={() => onEdit(d)}
            onHistory={() => onHistory(d)}
            onChangeStatus={() => onChangeStatus(d)}
            onDelete={() => onDelete(d)}
            onReview={() => onReview(d)}
            onPassages={() => onPassages(d)}
            onPublish={() => onPublish(d)}
            onClauses={() => onClauses(d)}
            canManage={canManage}
            walk={{
              row: d.id === walk?.first,
              open: d.id === walk?.open,
              review: d.id === walk?.review,
            }}
          />
        ))
      )}
    </tbody>
  )
}
