// One file's upload form on the Add documents tab (IN-01). It asks for the
// source type first, then only the details that type needs (AC1). Locked
// unless the row is a draft; the gateway's field errors show under each
// input. Used by screens/AddDocuments.tsx.
import { Badge, Icon, IconButton } from '../../../design-system'
import { fileSize } from '../display'
import { editDetails, removeUpload, type Upload } from '../uploads'
import { DetailsFields } from './DetailsFields'

const UPLOAD_STATE: Record<Upload['state'], { label: string; tone: string } | null> = {
  draft: null,
  uploading: { label: 'Uploading', tone: 'info' },
  // Accepted and queued; its live status is in the uploaded documents list.
  queued: { label: 'Uploaded', tone: 'low' },
  rejected: { label: 'Rejected', tone: 'critical' },
}

/** Returns one file's row: its name, state and details form. */
export function UploadRow({ upload }: { upload: Upload }) {
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
        <DetailsFields details={details} errors={fieldErrors} onChange={set} />
      )}
    </fieldset>
  )
}
