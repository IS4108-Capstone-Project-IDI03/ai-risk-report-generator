// The Knowledge base screen (IN-01), in three parts: KnowledgeBase (the "Add
// documents" panel), UploadRow (one file's details form) and UploadedDocuments
// (the server's list with ingestion status). Upload logic lives in uploads.ts;
// this file only displays it.
import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Select,
  Table,
} from '../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../assessments/demo-data'
import {
  listKnowledgeDocuments,
  type IngestionStatus,
  type KnowledgeDocument,
  type SourceType,
} from './api'
import {
  addFiles,
  clearFinished,
  editDetails,
  removeUpload,
  uploadAll,
  useUploads,
  type Upload,
} from './uploads'
import './knowledge-base.css'

const SOURCE_OPTIONS = [
  { value: '', label: 'Choose a source type' },
  { value: 'fm_standard', label: 'FM standard' },
  { value: 'nfpa_standard', label: 'NFPA standard' },
  { value: 'marsh_report', label: 'Marsh report' },
]
const SOURCE_LABELS: Record<SourceType, string> = {
  fm_standard: 'FM standard',
  nfpa_standard: 'NFPA standard',
  marsh_report: 'Marsh report',
}
const FACILITY_OPTIONS = [{ value: '', label: 'All facility types' }, ...FACILITY_TYPES]

const STATUS: Record<IngestionStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  complete: { label: 'Complete', tone: 'low' },
  failed: { label: 'Failed', tone: 'critical' },
}
const UPLOAD_STATE: Record<Upload['state'], { label: string; tone: string } | null> = {
  draft: null,
  uploading: { label: 'Uploading', tone: 'info' },
  // Accepted and queued; its live status is in the uploaded documents list.
  queued: { label: 'Uploaded', tone: 'low' },
  rejected: { label: 'Rejected', tone: 'critical' },
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
// The design system's literal date form, e.g. "29 Sep 11:24".
function uploadedAt(iso: string) {
  const date = new Date(iso)
  const time = date.toTimeString().slice(0, 5)
  return `${date.getDate()} ${date.toLocaleString('en-GB', { month: 'short' }).slice(0, 3)} ${time}`
}

// The "Add documents" panel: file picker, one row per file, Upload all, counter.
export function KnowledgeBase({ narrow }: { narrow: boolean }) {
  const uploads = useUploads()
  const drafts = uploads.filter((u) => u.state === 'draft').length
  const uploading = uploads.some((u) => u.state === 'uploading')
  const finished = uploads.some((u) => u.state === 'queued' || u.state === 'rejected')
  const acceptedCount = uploads.filter((u) => u.state === 'queued').length

  return (
    <div className="kb">
      <section className="kb-panel" aria-labelledby="kb-add-title">
        <header className="kb-panel-head">
          <div>
            <h2 id="kb-add-title">Add documents</h2>
            <p>PDF only, up to 100 MB each. Every file needs its own details.</p>
          </div>
          <label className="kb-pick">
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <Icon name="file-plus" size={16} />
            Choose PDF files
          </label>
        </header>

        {uploads.length === 0 ? (
          <p className="kb-empty">
            No files selected. Choose PDF files to enter their details and upload them.
          </p>
        ) : (
          <div className="kb-rows">
            {uploads.map((upload) => (
              <UploadRow key={upload.key} upload={upload} />
            ))}
          </div>
        )}

        {uploads.length > 0 && (
          <footer className="kb-panel-foot">
            <Button
              variant="primary"
              iconLeft="upload"
              disabled={drafts === 0 || uploading}
              loading={uploading}
              onClick={uploadAll}
            >
              Upload all
            </Button>
            {finished && (
              <Button variant="ghost" disabled={uploading} onClick={clearFinished}>
                Clear finished
              </Button>
            )}
            <span className="kb-count" role="status">
              {uploading
                ? 'Uploading…'
                : `${drafts} to upload${finished ? ` · ${acceptedCount} uploaded` : ''}`}
            </span>
          </footer>
        )}
      </section>

      <UploadedDocuments narrow={narrow} refreshKey={acceptedCount} />
    </div>
  )
}

// One file's details form. Locked unless the row is a draft; the gateway's
// field errors show under each input.
function UploadRow({ upload }: { upload: Upload }) {
  const { key, file, details, state, error, fieldErrors } = upload
  const locked = state !== 'draft'
  const badge = UPLOAD_STATE[state]
  const set = (change: Partial<typeof details>) => editDetails(key, change)

  return (
    <fieldset className="kb-row" aria-label={file.name} disabled={locked} data-state={state}>
      <div className="kb-row-head">
        <Icon name="file-text" size={16} />
        <span className="kb-file">{file.name}</span>
        <span className="kb-size">{fileSize(file.size)}</span>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {state === 'draft' && (
          <IconButton
            icon="x"
            label={`Remove ${file.name}`}
            size="sm"
            variant="ghost"
            onClick={() => removeUpload(key)}
          />
        )}
      </div>
      {error && (
        <p className={state === 'rejected' ? 'kb-reason kb-reason-rejected' : 'kb-reason'}>
          {error}
        </p>
      )}
      {state !== 'rejected' && state !== 'queued' && (
        <div className="kb-fields">
          <Input
            label="Title"
            required
            value={details.title}
            error={fieldErrors.title}
            onChange={(e) => set({ title: e.target.value })}
          />
          <Input
            label="Issuing body"
            required
            hint="e.g. FM Global, NFPA"
            value={details.issuingBody}
            error={fieldErrors.issuingBody}
            onChange={(e) => set({ issuingBody: e.target.value })}
          />
          <Input
            label="Edition"
            required
            hint="e.g. 2022 Edition"
            value={details.edition}
            error={fieldErrors.edition}
            onChange={(e) => set({ edition: e.target.value })}
          />
          <Input
            label="Effective date"
            type="date"
            required
            value={details.effectiveDate}
            error={fieldErrors.effectiveDate}
            onChange={(e) => set({ effectiveDate: e.target.value })}
          />
          <Select
            label="Source type"
            options={SOURCE_OPTIONS}
            value={details.sourceType}
            error={fieldErrors.sourceType}
            onChange={(e) => set({ sourceType: e.target.value as SourceType | '' })}
          />
          <Select
            label="Country"
            options={JURISDICTIONS}
            value={details.jurisdiction}
            error={fieldErrors.jurisdiction}
            onChange={(e) => set({ jurisdiction: e.target.value })}
          />
          <Select
            label="Facility type"
            hint="Optional"
            options={FACILITY_OPTIONS}
            value={details.facilityType}
            error={fieldErrors.facilityType}
            onChange={(e) => set({ facilityType: e.target.value })}
          />
        </div>
      )}
    </fieldset>
  )
}

// Accepted documents with their ingestion status, read from the gateway (the
// server's record, not this browser's). Re-read every 3 seconds while any is
// still queued or processing, and whenever a new upload is accepted. An
// unreachable gateway leaves the last list showing.
function UploadedDocuments({ narrow, refreshKey }: { narrow: boolean; refreshKey: number }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      listKnowledgeDocuments(controller.signal).then(
        (list) => {
          setDocuments(list)
          setUnreachable(false)
          if (list.some((d) => d.status === 'queued' || d.status === 'processing'))
            timer = setTimeout(load, 3000)
        },
        () => {
          if (!controller.signal.aborted) setUnreachable(true)
        },
      )
    void load()
    // Leaving the screen cancels the request in flight and the next re-read.
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refreshKey, attempt])

  const title = (d: KnowledgeDocument) => (
    <span className="kb-doc">
      <strong>{d.title}</strong>
      <small>
        {d.issuingBody} · {d.edition} · {SOURCE_LABELS[d.sourceType]}
      </small>
    </span>
  )
  const status = (d: KnowledgeDocument) => (
    <span className="kb-status">
      <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
      {d.error && <span className="kb-status-reason">{d.error}</span>}
    </span>
  )
  const original = (d: KnowledgeDocument) => (
    <a
      className="kb-link"
      href={d.fileUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`View original of ${d.title}`}
    >
      View original
    </a>
  )

  return (
    <section className="kb-uploaded" aria-labelledby="kb-uploaded-title">
      <h2 id="kb-uploaded-title">Uploaded documents</h2>
      {unreachable && (
        <Callout
          tone="danger"
          title="Uploaded documents not loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          The gateway could not be reached, so ingestion status is not up to date. Check that the
          server is running, then try again.
        </Callout>
      )}
      {documents === null ? (
        !unreachable && (
          <p className="kb-empty" role="status">
            Loading uploaded documents…
          </p>
        )
      ) : documents.length === 0 ? (
        <EmptyState
          icon="library"
          title="No documents uploaded yet"
          description="Documents appear here once an upload is accepted, with their ingestion status."
        />
      ) : narrow ? (
        <ul className="kb-stack" aria-label="Uploaded documents">
          {documents.map((d) => (
            <li key={d.id}>
              {title(d)}
              {status(d)}
              <span className="kb-stack-meta">
                <span className="kb-mono">{uploadedAt(d.uploadedAt)}</span>
                {original(d)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Table
          columns={[
            { key: 'document', header: 'Document' },
            { key: 'country', header: 'Country' },
            { key: 'uploaded', header: 'Uploaded' },
            { key: 'status', header: 'Status' },
            { key: 'original', header: 'Original' },
          ]}
          rows={documents.map((d) => ({
            id: d.id,
            document: title(d),
            country: d.jurisdiction,
            uploaded: <span className="kb-mono">{uploadedAt(d.uploadedAt)}</span>,
            status: status(d),
            original: original(d),
          }))}
        />
      )}
    </section>
  )
}
