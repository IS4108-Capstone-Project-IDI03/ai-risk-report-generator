// The knowledge base's Add documents tab (IN-01, IN-05): the upload panel
// (file picker and drop area, one UploadRow per file; a file uploads as soon
// as it is chosen or dropped), then UploadedDocuments.
// Shown by KnowledgeBase.tsx; upload logic lives in uploads.ts, this file only
// displays it.
import { useState } from 'react'
import { Button, Icon } from '../../../design-system'
import { UploadedDocuments } from '../components/UploadedDocuments'
import { UploadRow } from '../components/UploadRow'
import { addFiles, clearFinished, useUploads } from '../uploads'

/** Returns the Add documents tab: the upload panel, then recent uploads. */
export function AddDocuments({
  narrow,
  onCompleted,
  onReview,
}: {
  narrow: boolean
  onCompleted: (count: number) => void
  // Opens a document's Review page (IN-07).
  onReview: (id: string) => void
}) {
  const uploads = useUploads()
  const [dragging, setDragging] = useState(false)
  const uploading = uploads.some((u) => u.state === 'uploading')
  const finished = uploads.some((u) => u.state === 'queued' || u.state === 'rejected')
  const acceptedCount = uploads.filter((u) => u.state === 'queued').length

  return (
    <>
      <section
        className="kb-panel"
        data-dragging={dragging || undefined}
        aria-labelledby="kb-add-title"
        // Dropping PDFs anywhere on the panel uploads them, like choosing them.
        // The panel takes the focus style while files are over it.
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        // Moving onto a child also fires dragleave; only leaving the panel counts.
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles([...event.dataTransfer.files])
        }}
      >
        <header className="kb-panel-head">
          <div>
            <h2 id="kb-add-title">Add documents</h2>
            <p>
              PDF only, up to 100 MB each. Each file uploads as soon as you add it, and its details
              are read from the document.
            </p>
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
          <p className="kb-empty">No files yet. Drop PDF files here or choose them to upload.</p>
        ) : (
          <div className="kb-rows">
            {uploads.map((upload) => (
              <UploadRow key={upload.key} upload={upload} />
            ))}
          </div>
        )}

        {uploads.length > 0 && (
          <footer className="kb-panel-foot">
            {finished && (
              <Button variant="ghost" disabled={uploading} onClick={clearFinished}>
                Clear finished
              </Button>
            )}
            <span className="kb-count" role="status">
              {uploading ? 'Uploading…' : `${acceptedCount} uploaded`}
            </span>
          </footer>
        )}
      </section>

      <UploadedDocuments
        narrow={narrow}
        refreshKey={acceptedCount}
        onCompleted={onCompleted}
        onReview={onReview}
      />
    </>
  )
}
