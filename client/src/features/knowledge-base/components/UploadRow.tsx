// One file's row on the Add documents tab (IN-01, IN-05): its name, size and
// where its upload stands. While the gateway reads the document's details it
// shows a spinner and "Reading document details…". Used by
// screens/AddDocuments.tsx.
import { FileTile, Icon, IconButton } from '../../../design-system'
import { fileSize } from '../display'
import { removeUpload, retryUpload, type Upload } from '../uploads'
import { TonePill, type Tone } from './TonePill'

const UPLOAD_STATE: Record<Upload['state'], { label: string; tone: Tone; icon: string } | null> = {
  uploading: null,
  // Accepted and queued; its live status is in the uploaded documents list.
  queued: { label: 'Uploaded', tone: 'green', icon: 'circle-check' },
  // Accepted, but not read until a type is chosen in the uploads list (IN-19).
  awaiting_type: { label: 'Type needed', tone: 'amber', icon: 'triangle-alert' },
  rejected: { label: 'Rejected', tone: 'red', icon: 'octagon-alert' },
  failed: { label: 'Not uploaded', tone: 'red', icon: 'octagon-alert' },
}

/** Returns one file's row: its name and upload state. */
export function UploadRow({ upload }: { upload: Upload }) {
  const { key, file, state, error } = upload
  const badge = UPLOAD_STATE[state]
  const reason =
    state === 'awaiting_type' ? 'Choose its source type in Recent uploads.' : (error ?? null)

  return (
    <div className="kb-row" role="group" aria-label={file.name} data-state={state}>
      <FileTile name={file.name} contentType={file.type} />
      <div className="kb-row-main">
        <span className="kb-file" title={file.name}>
          {file.name}
        </span>
        <span className="kb-row-sub">
          {fileSize(file.size)}
          {state === 'uploading' && (
            <span className="kb-reading" role="status">
              {/* The shared class, so it pulses instead of freezing under reduced motion. */}
              <Icon name="loader-circle" size={14} className="ds-spin" />
              Reading document details…
            </span>
          )}
        </span>
        {reason && (
          <p className={state === 'awaiting_type' ? 'kb-reason is-quiet' : 'kb-reason'}>{reason}</p>
        )}
      </div>
      {badge && (
        <TonePill tone={badge.tone} icon={badge.icon}>
          {badge.label}
        </TonePill>
      )}
      {state === 'failed' && (
        <span className="kb-row-actions">
          <IconButton
            icon="rotate-ccw"
            label="Try again"
            tooltip="Try again"
            size="sm"
            style={{ borderRadius: 999, color: 'var(--graphite-600)' }}
            onClick={() => retryUpload(key)}
          />
          <IconButton
            icon="x"
            label={`Remove ${file.name}`}
            tooltip="Remove"
            size="sm"
            style={{ borderRadius: 999, color: 'var(--graphite-600)' }}
            onClick={() => removeUpload(key)}
          />
        </span>
      )}
    </div>
  )
}
