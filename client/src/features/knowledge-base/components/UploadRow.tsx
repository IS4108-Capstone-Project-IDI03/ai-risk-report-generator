// One file's row on the Add documents tab (IN-01, IN-05): its name, size and
// where its upload stands. While the gateway reads the document's details it
// shows a spinner and "Reading document details…". Used by
// screens/AddDocuments.tsx.
import { Badge, Button, Icon, IconButton } from '../../../design-system'
import { fileSize } from '../display'
import { removeUpload, retryUpload, type Upload } from '../uploads'

const UPLOAD_STATE: Record<Upload['state'], { label: string; tone: string } | null> = {
  uploading: null,
  // Accepted and queued; its live status is in the uploaded documents list.
  queued: { label: 'Uploaded', tone: 'low' },
  // Accepted, but not ingested until a type is chosen in the uploads list (IN-19).
  awaiting_type: { label: 'Type needed', tone: 'moderate' },
  rejected: { label: 'Rejected', tone: 'critical' },
  failed: { label: 'Not uploaded', tone: 'high' },
}

/** Returns one file's row: its name and upload state. */
export function UploadRow({ upload }: { upload: Upload }) {
  const { key, file, state, error } = upload
  const badge = UPLOAD_STATE[state]

  return (
    <div className="kb-row" role="group" aria-label={file.name} data-state={state}>
      <div className="kb-row-head">
        <Icon name="file-text" size={16} />
        <span className="kb-file">{file.name}</span>
        <span className="kb-size">{fileSize(file.size)}</span>
        {state === 'uploading' && (
          <span className="kb-reading" role="status">
            {/* The shared class, so it pulses instead of freezing under reduced motion. */}
            <Icon name="loader-circle" size={14} className="ds-spin" />
            Reading document details…
          </span>
        )}
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {state === 'failed' && (
          <Button variant="secondary" size="sm" onClick={() => retryUpload(key)}>
            Try again
          </Button>
        )}
        {state === 'failed' && (
          <IconButton
            icon="x"
            label={`Remove ${file.name}`}
            size="sm"
            variant="ghost"
            onClick={() => removeUpload(key)}
          />
        )}
      </div>
      {state === 'awaiting_type' && (
        <p className="kb-reason">Choose its source type in Recent uploads.</p>
      )}
      {error && (
        <p className={state === 'rejected' ? 'kb-reason kb-reason-rejected' : 'kb-reason'}>
          {error}
        </p>
      )}
    </div>
  )
}
