// A document's edit history (KB-01 AC9): the details each correction
// replaced, newest first, each with Restore (AC10). A bottom sheet on phones,
// like Edit details. Opened by screens/KnowledgeDocuments.tsx, which hands a
// restored version to components/EditDetailsDialog.tsx.
import { Button, Dialog } from '../../../design-system'
import type { DocumentVersion, KnowledgeDocument, StoredDetails } from '../api'
import { calendarDate, countryName, dateTime, facilityName, sourceLabel } from '../display'

/** Returns the Edit history dialog for one document. */
export function EditHistoryDialog({
  document: d,
  onClose,
  onRestore,
}: {
  document: KnowledgeDocument
  onClose: () => void
  onRestore: (version: DocumentVersion) => void
}) {
  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit history"
      description={d.title}
      width={560}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {d.history.length === 0 ? (
        <p className="kb-versions-none">No corrections yet.</p>
      ) : (
        <ul className="kb-versions">
          {d.history.map((version, i) => (
            <li key={version.replacedAt}>
              <div className="kb-version">
                <p className="kb-version-meta">
                  <time dateTime={version.replacedAt}>{dateTime(version.replacedAt)}</time>
                  <span aria-hidden="true"> · </span>
                  <span>{version.replacedBy.name}</span>
                </p>
                {/* Each entry holds the details before one correction. What they
                    became is the entry above (newer), or the current details
                    for the top one. */}
                {changes(version, i === 0 ? d : d.history[i - 1]).map((c) => (
                  <p key={c.label} className="kb-version-change">
                    <span className="kb-change-field">{c.label}:</span>{' '}
                    <span className="kb-change-old">{c.before}</span> →{' '}
                    <span className="kb-change-new">{c.after}</span>
                  </p>
                ))}
              </div>
              {/* Restore opens Edit details, which a withdrawn document can't use (KB-01 AC15). */}
              {!d.withdrawn && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Restore the version from ${dateTime(version.replacedAt)}`}
                  onClick={() => onRestore(version)}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

// Each detail a correction can change, as it reads on screen.
const SHOWN: [label: string, read: (d: StoredDetails) => string][] = [
  ['Source type', (d) => sourceLabel(d.sourceType)],
  ['Title', (d) => d.title],
  ['Standard number', (d) => d.standardNumber ?? 'none'],
  ['Edition', (d) => d.edition ?? 'none'],
  ['Date', (d) => calendarDate(d.effectiveDate)],
  ['Country', (d) => countryName(d.jurisdiction)],
  ['Facility type', (d) => facilityName(d.facilityType)],
]

// What a correction changed, e.g. Country: Malaysia → Singapore.
function changes(before: StoredDetails, after: StoredDetails) {
  return SHOWN.filter(([, read]) => read(before) !== read(after)).map(([label, read]) => ({
    label,
    before: read(before),
    after: read(after),
  }))
}
