// One source type's documents in the Documents table (KB-01): a group header with its icon, name
// and count (the Assessments list's client › site header look), then its rows. Used by
// screens/KnowledgeDocuments.tsx; renders components/DocumentRow.tsx.
import { CountPill, Icon } from '../../../design-system'
import type { KnowledgeDocument } from '../api'
import type { Group } from '../documentGroups'
import { DocumentRow } from './DocumentRow'

// The table's column count, so a header or note row spans the whole width.
const COLUMNS = 3

/** Returns one group's rows as a table body. */
export function DocumentGroup({
  group,
  documents,
  openId,
  focused,
  onOpen,
  onReview,
  canManage,
  walk,
}: {
  group: Group
  documents: KnowledgeDocument[]
  // The document whose details panel is open.
  openId: string | null
  focused?: string | null
  onOpen: (document: KnowledgeDocument) => void
  onReview: (document: KnowledgeDocument) => void
  // Off for a risk engineer, who browses read-only (IN-17).
  canManage: boolean
  // The ids of the rows the walkthroughs point at (F-12), see KnowledgeDocuments.tsx.
  walk?: { first?: string; open?: string; review?: string }
}) {
  const id = `kb-group-${group.sourceType ?? 'unconfirmed'}`
  return (
    <tbody aria-labelledby={id}>
      <tr className="kb-band">
        <th colSpan={COLUMNS} scope="colgroup">
          <span className="kb-band-inner">
            <Icon name={group.icon} size={16} color="var(--graphite-600)" />
            <span id={id}>{group.title}</span>
            <CountPill>{documents.length}</CountPill>
          </span>
        </th>
      </tr>
      {documents.length === 0 ? (
        <tr className="kb-empty-row">
          <td colSpan={COLUMNS} className="kb-list-note">
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
            onOpen={() => onOpen(d)}
            onReview={() => onReview(d)}
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
