// The client page's Documents tab (CP-23 AC14, AC15, AC16; board 07): search,
// Tag filter and Upload, then a table of the client's files, each with its tag,
// opened as the original or deleted after a confirm. Called by ClientRecord.
// Calls the documents hook passed in and the toast helper for every action.
import { useRef, useState, type ChangeEvent } from 'react'
import {
  AddRow,
  Button,
  EmptyState,
  SearchField,
  TableFooter,
  TAG_GROUPS,
  toast,
  useIsPhone,
} from '../../../design-system'
import type { ClientDocument, Placement } from '../api'
import { DeleteDocumentDialog } from '../components/DeleteDocumentDialog'
import { DocumentRow } from '../components/DocumentRow'
import { FilterMenu } from '../components/FilterMenu'
import { plural } from '../formatClient'
import type { useClientDocuments } from '../useClientDocuments'
import { useDocumentTags } from '../useDocumentTags'
import { ACCEPT } from '../../new-assessment/reading'

export function DocumentsTab({
  clientId,
  docs,
}: {
  clientId: string
  docs: ReturnType<typeof useClientDocuments>
}) {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [deleting, setDeleting] = useState<ClientDocument | null>(null)
  const [uploading, setUploading] = useState(false)
  const phone = useIsPhone()
  // Rows that just changed, for the board 17 · 7 motions: new (tint 1 s), retagged, leaving (fade-out).
  const [fresh, setFresh] = useState<string[]>([])
  const [retagged, setRetagged] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const tags = useDocumentTags(clientId)
  const { documents, failed } = docs

  // Uploads the chosen files, then says how many were kept and why any were refused.
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      const results = await docs.upload(files)
      const kept = results.filter((r) => r.status === 'kept').length
      const ids = results.flatMap((r) => (r.status === 'kept' ? [r.document.id] : []))
      setFresh(ids)
      setTimeout(() => setFresh([]), 1300)
      const refused = results.flatMap((r) => (r.status === 'refused' ? [r] : []))
      if (kept) toast.success(`${plural(kept, 'document')} uploaded`)
      if (refused.length)
        toast.error(
          refused.length === 1
            ? `${refused[0].name} not uploaded`
            : `${refused.length} files not uploaded`,
          {
            description: refused
              .map((r) => (refused.length === 1 ? r.reason : `${r.name}: ${r.reason}`))
              .join(' '),
          },
        )
    } catch {
      toast.error('Upload failed', { description: 'Check your connection and try again.' })
    }
    setUploading(false)
  }

  // Moves a document to the tag chosen in its picker.
  const retag = async (doc: ClientDocument, value: string) => {
    const label = tags.find((t) => t.value === value)?.label ?? 'the new tag'
    setRetagged(doc.id)
    setTimeout(() => setRetagged(null), 400)
    try {
      await docs.retag(doc.id, JSON.parse(value) as Placement)
      toast.success(`Tag changed to ${label}`)
    } catch (error: unknown) {
      toast.error('Tag not changed', {
        description: error instanceof Error ? error.message : 'Try again.',
      })
    }
  }

  if (failed)
    return (
      <div className="cl-card">
        <EmptyState
          icon="file-warning"
          title="Documents could not be loaded"
          description="The gateway could not be reached. Check your connection and try again."
        />
      </div>
    )
  if (!documents) return <p role="status">{'Loading documents…'}</p>

  const search = q.trim().toLowerCase()
  const shown = documents.filter(
    (d) => (!tag || d.tag === tag) && (!search || d.name.toLowerCase().includes(search)),
  )
  const pickFiles = () => picker.current?.click()
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        aria-label="Choose documents to upload"
        onChange={upload}
      />
      <div className="cl-card">
        <div className="cl-toolbar">
          <SearchField
            label="Search documents"
            placeholder="Search documents"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <FilterMenu
            name="Tag"
            choices={tags.map((t) => ({
              value: t.label,
              label: t.label,
              icon: TAG_GROUPS.find((g) => g.group === (t.group ?? 'client'))?.icon,
            }))}
            value={tag}
            onChange={setTag}
          />
          <span className="cl-toolbar-end">
            <Button
              variant="create"
              iconLeft="upload"
              fullWidth={phone}
              loading={uploading}
              onClick={pickFiles}
            >
              {'Upload'}
            </Button>
          </span>
        </div>
        {documents.length === 0 ? (
          <div className="cl-empty">
            <p className="cl-empty-title">{'No documents yet'}</p>
            <AddRow onClick={pickFiles}>{'Add documents'}</AddRow>
          </div>
        ) : (
          <>
            <table className="cl-table cl-docs" aria-label="Documents">
              <colgroup>
                <col />
                <col className="cl-col-tag" />
                <col className="cl-col-date" />
                <col className="cl-col-size" />
                <col className="cl-col-actions-2" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{'Document'}</th>
                  <th scope="col">{'Tag'}</th>
                  <th scope="col">{'Added'}</th>
                  <th scope="col">{'Size'}</th>
                  <th scope="col">
                    <span className="cl-sr">{'Actions'}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <DocumentRow
                    key={d.id}
                    doc={d}
                    tagOptions={tags}
                    onTag={retag}
                    fresh={fresh.includes(d.id)}
                    retagged={retagged === d.id}
                    leaving={leaving === d.id}
                    onDelete={setDeleting}
                  />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <p className="cl-empty-title" role="status">
                {'No documents match'}
              </p>
            )}
            <div className="cl-add">
              <AddRow onClick={pickFiles}>{'Add documents'}</AddRow>
            </div>
            <TableFooter>{plural(documents.length, 'document')}</TableFooter>
          </>
        )}
      </div>
      {deleting && (
        <DeleteDocumentDialog
          doc={deleting}
          remove={async (id) => {
            // The row fades out (120 ms) before the table closes up.
            setLeaving(id)
            await new Promise((done) => setTimeout(done, 120))
            try {
              await docs.remove(id)
            } catch (error) {
              setLeaving(null)
              throw error
            }
            toast.success(`${deleting.name} deleted`)
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
