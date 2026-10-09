// One source type's documents in the Documents table (KB-01): a band with
// its name and count, then its rows. Used by screens/KnowledgeDocuments.tsx;
// renders components/DocumentRow.tsx.
import { Badge, Icon } from '../../../design-system'
import type { KnowledgeDocument, SourceType } from '../api'
import { DocumentRow } from './DocumentRow'

// One of the table's headings (AC1); a null source type is the Unconfirmed
// group (IN-05).
export type Group = { sourceType: SourceType | null; title: string; icon: string }

/** Returns one group's rows as a table body. */
export function DocumentGroup({
  group,
  documents,
  openId,
  onToggle,
  onEdit,
  onHistory,
  onChangeStatus,
  onReview,
}: {
  group: Group
  documents: KnowledgeDocument[]
  openId: string | null
  onToggle: (id: string) => void
  onEdit: (document: KnowledgeDocument) => void
  onHistory: (document: KnowledgeDocument) => void
  onChangeStatus: (document: KnowledgeDocument) => void
  onReview: (document: KnowledgeDocument) => void
}) {
  const id = `kb-group-${group.sourceType ?? 'unconfirmed'}`
  return (
    <tbody aria-labelledby={id}>
      <tr className="kb-band">
        <th colSpan={4} scope="colgroup">
          <span className="kb-band-inner">
            <Icon name={group.icon} size={15} />
            <span id={id}>{group.title}</span>
            <Badge tone="info">{documents.length}</Badge>
          </span>
        </th>
      </tr>
      {documents.length === 0 ? (
        <tr>
          <td colSpan={4} className="kb-list-note">
            No {group.title.replace('Past ', 'past ')} yet.
          </td>
        </tr>
      ) : (
        documents.map((d) => (
          <DocumentRow
            key={d.id}
            document={d}
            open={openId === d.id}
            onToggle={() => onToggle(d.id)}
            onEdit={() => onEdit(d)}
            onHistory={() => onHistory(d)}
            onChangeStatus={() => onChangeStatus(d)}
            onReview={() => onReview(d)}
          />
        ))
      )}
    </tbody>
  )
}
