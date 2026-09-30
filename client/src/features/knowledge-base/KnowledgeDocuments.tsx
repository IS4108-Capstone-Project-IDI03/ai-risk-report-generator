// The knowledge base's Documents tab (KB-01): every active document, grouped
// by source type, filtered by label, each correctable in an Edit details
// dialog. Shown by KnowledgeBase.tsx; talks to the gateway through api.ts.
import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  IconRegistry,
  Select,
  Table,
} from '../../design-system'
import { GatewayError } from '../assessments/api'
import { FACILITY_TYPES, JURISDICTIONS } from '../assessments/demo-data'
import {
  correctKnowledgeDocument,
  listActiveDocuments,
  type DocumentDetails,
  type KnowledgeDocument,
  type SourceType,
} from './api'
import { DetailsFields } from './DetailsFields'
import { calendarDate, countryName, facilityName } from './display'
import { editionProblem, withSourceType } from './uploads'

const GROUPS: { sourceType: SourceType; title: string }[] = [
  { sourceType: 'fm_standard', title: 'FM standards' },
  { sourceType: 'nfpa_standard', title: 'NFPA standards' },
  { sourceType: 'marsh_report', title: 'Past Marsh reports' },
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
const NO_FILTERS = { jurisdiction: '', facilityType: '' }

/** Returns the Documents tab: active documents in groups, with filters and Edit details. */
export function KnowledgeDocuments({
  narrow,
  notify,
  onAdd,
}: {
  narrow: boolean
  notify: (message: string) => void
  onAdd: () => void
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null)

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

  const filtering = filters.jurisdiction !== '' || filters.facilityType !== ''
  const shown = (documents ?? []).filter(
    (d) =>
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
    notify('Details saved. Search now uses the corrected labels.')
  }
  const clearFilters = () => setFilters(NO_FILTERS)

  return (
    <section className="kb-docs" aria-labelledby="kb-docs-title">
      <header className="kb-docs-head">
        <div>
          <h2 id="kb-docs-title">Active documents</h2>
          <p>
            Every document search can use. Uploads still ingesting, or that failed, are under Add
            documents.
          </p>
        </div>
      </header>

      <div className="kb-toolbar">
        <Select
          label="Country"
          options={COUNTRY_FILTER}
          value={filters.jurisdiction}
          onChange={(e) => setFilters({ ...filters, jurisdiction: e.target.value })}
        />
        <Select
          label="Facility type"
          options={FACILITY_FILTER}
          value={filters.facilityType}
          onChange={(e) => setFilters({ ...filters, facilityType: e.target.value })}
        />
        {filtering && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        {documents && (
          <span className="kb-count" role="status">
            {filtering && `${shown.length} of `}
            {documents.length} {documents.length === 1 ? 'document' : 'documents'}
          </span>
        )}
      </div>

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

      {documents === null ? (
        !unreachable && (
          <p className="kb-empty" role="status">
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
        GROUPS.map((group) => {
          const rows = shown.filter((d) => d.sourceType === group.sourceType)
          // While filtering, an empty group is noise; unfiltered, it says so.
          if (filtering && rows.length === 0) return null
          return (
            <DocumentGroup
              key={group.sourceType}
              title={group.title}
              documents={rows}
              narrow={narrow}
              onEdit={setEditing}
            />
          )
        })
      )}

      {editing && (
        <EditDetailsDialog document={editing} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </section>
  )
}

// One source type's documents: a table, or a stacked list on narrow screens.
function DocumentGroup({
  title,
  documents,
  narrow,
  onEdit,
}: {
  title: string
  documents: KnowledgeDocument[]
  narrow: boolean
  onEdit: (document: KnowledgeDocument) => void
}) {
  const id = `kb-group-${title.replace(/\W+/g, '-').toLowerCase()}`
  const name = (d: KnowledgeDocument) => (
    <span className="kb-doc">
      <strong>{d.title}</strong>
      <small>
        {d.edition
          ? `${d.issuingBody} · ${d.edition} Edition`
          : `Report date ${calendarDate(d.effectiveDate)}`}
      </small>
    </span>
  )
  const status = <Badge tone="low">Active</Badge>
  const actions = (d: KnowledgeDocument) => (
    <span className="kb-actions">
      <a
        className="kb-link"
        href={d.fileUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`View original of ${d.title}`}
      >
        View original
      </a>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={IconRegistry.action.edit}
        aria-label={`Edit details of ${d.title}`}
        onClick={() => onEdit(d)}
      >
        Edit details
      </Button>
    </span>
  )

  return (
    <section className="kb-group" aria-labelledby={id}>
      <h3>
        <span id={id}>{title}</span> <span className="kb-group-count">{documents.length}</span>
      </h3>
      {documents.length === 0 ? (
        <p className="kb-empty">No {title.replace('Past ', 'past ')} yet.</p>
      ) : narrow ? (
        <ul className="kb-stack" aria-label={title}>
          {documents.map((d) => (
            <li key={d.id}>
              {name(d)}
              <span className="kb-stack-meta">
                <span className="kb-labels">
                  <span>{countryName(d.jurisdiction)}</span>
                  <span>{facilityName(d.facilityType)}</span>
                </span>
                {status}
              </span>
              {actions(d)}
            </li>
          ))}
        </ul>
      ) : (
        <Table
          columns={[
            { key: 'document', header: 'Document' },
            { key: 'country', header: 'Country', width: '16%' },
            { key: 'facility', header: 'Facility type', width: '18%' },
            { key: 'status', header: 'Status', width: '10%' },
            { key: 'actions', header: 'Actions', width: '1%' },
          ]}
          rows={documents.map((d) => ({
            id: d.id,
            document: name(d),
            country: countryName(d.jurisdiction),
            facility: facilityName(d.facilityType),
            status,
            actions: actions(d),
          }))}
        />
      )}
    </section>
  )
}

// The form's values for a stored document. A standard's "all" facility type
// is the form's blank "All facility types" choice.
function formDetails(d: KnowledgeDocument): DocumentDetails {
  const standard = d.sourceType !== 'marsh_report'
  return {
    sourceType: d.sourceType,
    title: d.title,
    edition: d.edition ?? '',
    effectiveDate: d.effectiveDate,
    jurisdiction: d.jurisdiction,
    facilityType: standard && d.facilityType === 'all' ? '' : d.facilityType,
  }
}

// Corrects one document's details (AC6, AC7): the upload form's fields,
// filled in. A refused value shows its reason under the field and nothing is
// saved; any other failure shows its reason above the fields.
function EditDetailsDialog({
  document,
  onClose,
  onSaved,
}: {
  document: KnowledgeDocument
  onClose: () => void
  onSaved: (updated: KnowledgeDocument) => void
}) {
  const [details, setDetails] = useState(() => formDetails(document))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Same rule as an upload row: changing the source type starts that type's
  // own fields afresh; an edited field's old error no longer applies.
  const change = (next: Partial<DocumentDetails>) => {
    const base =
      next.sourceType !== undefined && next.sourceType !== details.sourceType
        ? withSourceType(details, next.sourceType)
        : details
    setDetails({ ...base, ...next })
    setErrors(Object.fromEntries(Object.entries(errors).filter(([field]) => !(field in next))))
  }

  const save = async () => {
    // A bad edition is caught here, so nothing is sent.
    const edition = editionProblem(details)
    if (edition) {
      setErrors({ edition })
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      onSaved(await correctKnowledgeDocument(document.id, details))
    } catch (error: unknown) {
      const refused = error instanceof GatewayError && error.status === 400
      setErrors(refused ? error.fields : {})
      setProblem(
        error instanceof GatewayError && error.status === null
          ? 'The gateway could not be reached, so the details were not saved. Try again.'
          : refused && Object.keys(error.fields).length > 0
            ? null
            : error instanceof Error
              ? error.message
              : 'The details were not saved.',
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      className="ds-dialog-sheet"
      title="Edit details"
      description={document.fileName}
      width={600}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save details
          </Button>
        </>
      }
    >
      <div className="kb-edit">
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Details not saved">
              {problem}
            </Callout>
          </div>
        )}
        <p className="kb-edit-note">
          Search uses the corrected labels as soon as you save. The document is not re-ingested.
        </p>
        <DetailsFields details={details} errors={errors} onChange={change} />
      </div>
    </Dialog>
  )
}
