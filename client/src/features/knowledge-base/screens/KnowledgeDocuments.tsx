// The knowledge base's Documents tab (KB-01): every active document, grouped
// by source type, filtered by label or title search. Opening a document's
// title shows its details; Edit details and Restore open one dialog.
// Shown by KnowledgeBase.tsx; talks to the gateway through api.ts.
import { useEffect, useState } from 'react'
import { Button, Callout, EmptyState, IconRegistry, Input, Select } from '../../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../../assessments/demo-data'
import { listActiveDocuments, type DocumentVersion, type KnowledgeDocument } from '../api'
import { DocumentGroup, type Group } from '../components/DocumentGroup'
import { EditDetailsDialog } from '../components/EditDetailsDialog'
import { EditHistoryDialog } from '../components/EditHistoryDialog'

const GROUPS: Group[] = [
  { sourceType: 'fm_standard', title: 'FM standards', icon: IconRegistry.evidence.standard },
  { sourceType: 'nfpa_standard', title: 'NFPA standards', icon: IconRegistry.evidence.standard },
  { sourceType: 'marsh_report', title: 'Past Marsh reports', icon: IconRegistry.evidence.report },
]
// '' is "don't filter"; 'all' is a value of its own, so "All countries" finds
// only documents labelled for all countries (exact match, AC4).
const COUNTRY_FILTER = [
  { value: '', label: 'Any country' },
  { value: 'all', label: 'All countries' },
  ...JURISDICTIONS,
]
const FACILITY_FILTER = [
  { value: '', label: 'Any facility type' },
  { value: 'all', label: 'All facility types' },
  ...FACILITY_TYPES,
]
const NO_FILTERS = { title: '', jurisdiction: '', facilityType: '' }

// A fuzzy title match: the typed letters appear in the title in order, with
// gaps allowed, ignoring case and spaces ("nfpa13" finds "NFPA 13 …").
// ponytail: no typo tolerance; add a fuzzy library if admins ask for it.
function titleMatches(title: string, query: string) {
  const t = title.toLowerCase()
  let at = 0
  for (const letter of query.toLowerCase().replace(/\s/g, '')) {
    at = t.indexOf(letter, at) + 1
    if (at === 0) return false
  }
  return true
}

// What the Edit details dialog opens on: the document, and the version being
// restored, if any (AC10).
type Editing = { document: KnowledgeDocument; version?: DocumentVersion }

/** Returns the Documents tab: active documents in groups, with filters and details. */
export function KnowledgeDocuments({
  notify,
  onAdd,
}: {
  notify: (message: string) => void
  onAdd: () => void
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [historyOf, setHistoryOf] = useState<KnowledgeDocument | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listActiveDocuments(controller.signal).then(
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

  const filtering = Object.values(filters).some((value) => value.trim() !== '')
  const shown = (documents ?? []).filter(
    (d) =>
      titleMatches(d.title, filters.title) &&
      (!filters.jurisdiction || d.jurisdiction === filters.jurisdiction) &&
      (!filters.facilityType || d.facilityType === filters.facilityType),
  )
  // A saved correction replaces the row in place; the gateway's list is
  // sorted by title, which a corrected title may change, so re-sort.
  const saved = (updated: KnowledgeDocument) => {
    setDocuments((list) =>
      (list ?? [])
        .map((d) => (d.id === updated.id ? updated : d))
        .sort((a, b) => a.title.localeCompare(b.title, 'en')),
    )
    setEditing(null)
    // Without this, a corrected document that no longer matches the filters
    // would just vanish, with no sign the save worked.
    notify(`Details saved for ${updated.title}.`)
  }
  const clearFilters = () => setFilters(NO_FILTERS)
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id))

  return (
    <section className="kb-docs" aria-labelledby="kb-docs-title">
      <header className="kb-docs-head">
        <h2 id="kb-docs-title">Active documents</h2>
        <p>
          Every document search can use. Uploads still ingesting, or that failed, are under Add
          documents.
        </p>
      </header>

      {unreachable && (
        <Callout
          tone="danger"
          title="Knowledge base not loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          The gateway could not be reached. Check that the server is running, then try again.
        </Callout>
      )}

      <div className="kb-list">
        <div className="kb-toolbar">
          <Input
            size="sm"
            type="search"
            iconLeft="search"
            aria-label="Search titles"
            placeholder="Search titles"
            value={filters.title}
            onChange={(e) => setFilters({ ...filters, title: e.target.value })}
          />
          <Select
            size="sm"
            aria-label="Country"
            options={COUNTRY_FILTER}
            value={filters.jurisdiction}
            onChange={(e) => setFilters({ ...filters, jurisdiction: e.target.value })}
          />
          <Select
            size="sm"
            aria-label="Facility type"
            options={FACILITY_FILTER}
            value={filters.facilityType}
            onChange={(e) => setFilters({ ...filters, facilityType: e.target.value })}
          />
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          {/* The result of the filters, at the strip's far end; the numbers
              carry the weight, the words stay quiet. */}
          {documents && (
            <span className="kb-count" role="status">
              {filtering ? (
                <>
                  Showing <b>{shown.length}</b> of <b>{documents.length}</b> documents
                </>
              ) : (
                <>
                  Total <b>{documents.length}</b>{' '}
                  {documents.length === 1 ? 'document' : 'documents'}
                </>
              )}
            </span>
          )}
        </div>

        {documents === null ? (
          !unreachable && (
            <p className="kb-list-note" role="status">
              Loading the knowledge base…
            </p>
          )
        ) : filtering && shown.length === 0 ? (
          <EmptyState
            icon={IconRegistry.action.filter}
            title="No documents match these filters"
            description="Clear a filter or choose another value to see the other documents."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon="library"
            title="The knowledge base is empty"
            description="Documents appear here once an upload finishes ingesting."
            action={
              <Button variant="secondary" iconLeft="upload" onClick={onAdd}>
                Add documents
              </Button>
            }
          />
        ) : (
          // A real table, so every header sits over its own column.
          <table className="kb-table">
            <thead>
              <tr>
                <th className="kb-col-toggle" aria-label="Open details" />
                <th>Document</th>
                <th>Country</th>
                <th>Facility type</th>
                <th>Status</th>
                <th>Original</th>
              </tr>
            </thead>
            {GROUPS.map((group) => {
              const rows = shown.filter((d) => d.sourceType === group.sourceType)
              // While filtering, an empty group is noise; unfiltered, it says so.
              if (filtering && rows.length === 0) return null
              return (
                <DocumentGroup
                  key={group.sourceType}
                  group={group}
                  documents={rows}
                  openId={openId}
                  onToggle={toggle}
                  onEdit={(document) => setEditing({ document })}
                  onHistory={setHistoryOf}
                />
              )
            })}
          </table>
        )}
      </div>

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

      {editing && (
        <EditDetailsDialog
          key={editing.version?.replacedAt ?? 'current'}
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </section>
  )
}
