// The knowledge base's Add documents tab (IN-01): the upload panel (file
// picker, one UploadRow per file, Upload all), then UploadedDocuments.
// Shown by KnowledgeBase.tsx; upload logic lives in uploads.ts, this file only
// displays it.
import { Button, Icon } from '../../../design-system'
import { UploadedDocuments } from '../components/UploadedDocuments'
import { UploadRow } from '../components/UploadRow'
import { addFiles, clearFinished, uploadAll, useUploads } from '../uploads'

/** Returns the Add documents tab: the upload panel, then recent uploads. */
export function AddDocuments({ narrow }: { narrow: boolean }) {
  const uploads = useUploads()
  const drafts = uploads.filter((u) => u.state === 'draft').length
  const uploading = uploads.some((u) => u.state === 'uploading')
  const finished = uploads.some((u) => u.state === 'queued' || u.state === 'rejected')
  const acceptedCount = uploads.filter((u) => u.state === 'queued').length

  return (
    <>
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
    </>
  )
}
