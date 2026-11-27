// The knowledge base's Add documents tab (IN-01, IN-05): the upload panel
// (file picker and drop area, one UploadRow per file; a file uploads as soon
// as it is chosen or dropped), then UploadedDocuments.
// Shown by KnowledgeBase.tsx; upload logic lives in uploads.ts, this file only
// displays it.
import { useRef, useState } from 'react'
import { AddRow, Button, Icon } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import type { KnowledgeDocument } from '../api'
import { ManualEntryDialog } from '../components/ManualEntryDialog'
import { UploadedDocuments } from '../components/UploadedDocuments'
import { UploadRow } from '../components/UploadRow'
import { addFiles, clearFinished, useUploads, type Upload } from '../uploads'
import '../add-documents.css'

/** Returns the Add documents tab: the upload panel, then recent uploads. */
export function AddDocuments({
  onCompleted,
  onReview,
  onEnterManually,
}: {
  onCompleted: (count: number) => void
  // Opens a document's Review page (IN-07).
  onReview: (id: string) => void
  // Opens a manual draft's clauses, new or already being entered (IN-18).
  onEnterManually: (id: string) => void
}) {
  const uploads = useUploads()
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [manual, setManual] = useState(false)
  const uploading = uploads.some((u) => u.state === 'uploading')
  // F-12: ready once Recent uploads has loaded (its rows are what two steps point at); held while a
  // file is still uploading.
  const [recent, setRecent] = useState<KnowledgeDocument[] | null>(null)
  useWalkthroughScreen('knowledge-add', recent !== null, uploading && 'unsaved')
  // One awaiting a type (IN-19) was accepted too: it is in Recent uploads.
  const accepted = (u: Upload) => u.state === 'queued' || u.state === 'awaiting_type'
  const finished = uploads.some((u) => accepted(u) || u.state === 'rejected')
  const acceptedCount = uploads.filter(accepted).length

  return (
    <div className="kb-content">
      <section
        className="kb-panel"
        data-dragging={dragging || undefined}
        data-walk="knowledge-add.panel"
        aria-label="Add documents"
        // Dropping files anywhere on the panel uploads them, like choosing them.
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
        <div className="kb-drop">
          <span className="kb-drop-icon" aria-hidden="true">
            <Icon name="file-up" size={20} />
          </span>
          <div className="kb-drop-text">
            {/* The (?) sits on the title line, so it never wraps onto a line of its own. */}
            <div className="kb-drop-title">
              Drop files here, or choose{' '}
              <span className="kb-drop-last">
                them
                <Tip id="knowledge-add.upload" />
              </span>
            </div>
            <div className="kb-drop-sub">PDF, Word, PowerPoint, RTF or ODT, up to 100 MB each.</div>
          </div>
          <input
            ref={picker}
            type="file"
            hidden
            aria-label="Choose files"
            // The gateway reads each file's type from its bytes and refuses the rest.
            accept=".pdf,.docx,.doc,.pptx,.ppt,.rtf,.odt"
            multiple
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
          <Button variant="create" iconLeft="upload" onClick={() => picker.current?.click()}>
            Choose files
          </Button>
        </div>

        {uploads.length > 0 && (
          <div className="kb-rows">
            {uploads.map((upload) => (
              <UploadRow key={upload.key} upload={upload} />
            ))}
          </div>
        )}

        {uploads.length > 0 && (
          <footer className="kb-panel-foot">
            <span role="status">{uploading ? 'Uploading…' : `${acceptedCount} uploaded`}</span>
            {finished && (
              <Button variant="ghost" size="sm" pill disabled={uploading} onClick={clearFinished}>
                Clear finished
              </Button>
            )}
          </footer>
        )}
      </section>

      {/* For a standard with no file, such as an edition only readable online (IN-18). */}
      <AddRow data-walk="knowledge-add.manual" onClick={() => setManual(true)}>
        Enter a standard manually
      </AddRow>

      {manual && <ManualEntryDialog onClose={() => setManual(false)} onOpen={onEnterManually} />}

      <UploadedDocuments
        refreshKey={acceptedCount}
        onCompleted={onCompleted}
        onLoaded={setRecent}
        onReview={onReview}
      />
    </div>
  )
}
