import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import { Icon } from '../../../design-system'
import { ZoomBadge } from './ZoomBadge'
import '../capture.css'

// Pickers and the waiting list shared by the capture screen (CP-03, CP-04)
// and the Add media dialog (CP-08).

// A gloved-hand-sized picker in the pale navy fill; its hidden file input
// (ds-choice) is the real control. Two side by side share the row, and wrap on a phone.
const pickerStyle = (busy: boolean): CSSProperties => ({
  flex: '1 1 200px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minHeight: '48px',
  border: 0,
  borderRadius: '12px',
  background: 'var(--cap-fill)',
  color: busy ? 'var(--text-muted)' : 'var(--marsh-navy)',
  fontSize: '16px',
  fontWeight: '600',
  cursor: busy ? 'not-allowed' : 'pointer',
})

// Two pickers (CP-04 AC6): Chrome on Android 14+ offers no camera in its
// photo picker, so taking one needs `capture`, which in turn leaves out the
// library. Take photograph is hidden on a desktop, which ignores `capture`
// (workflow.css). Scan mode names them for pages of notes (CP-19).
export function PhotoPickers({
  onChange,
  busy,
  takeLabel = 'Take photograph',
  chooseLabel = 'Choose photographs',
}: {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  busy: boolean
  takeLabel?: string
  chooseLabel?: string
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
      <label className="ds-choice photo-take" style={pickerStyle(busy)}>
        <Icon name="camera" size={16} />
        {takeLabel}
        <input
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          onChange={onChange}
          disabled={busy}
        />
      </label>
      <label className="ds-choice" style={pickerStyle(busy)}>
        <Icon name="image" size={16} />
        {chooseLabel}
        <input
          type="file"
          accept="image/jpeg,image/png"
          multiple
          onChange={onChange}
          disabled={busy}
        />
      </label>
    </div>
  )
}

// Record from the microphone, or upload audio files, as two pickers like the
// photo ones (CP-08's Add media; capture has its own, larger recorder).
export function AudioPickers({
  recording,
  onRecord,
  onUpload,
  busy,
}: {
  recording: boolean
  onRecord: () => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  busy: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
      <button type="button" onClick={onRecord} disabled={busy} style={pickerStyle(busy)}>
        <Icon name={recording ? 'square' : 'mic'} size={16} />
        {recording ? 'Stop recording' : 'Record'}
      </button>
      <label className="ds-choice" style={pickerStyle(busy || recording)}>
        <Icon name="upload" size={16} />
        {'Upload audio files'}
        <input
          type="file"
          accept="audio/*"
          multiple
          onChange={onUpload}
          disabled={busy || recording}
        />
      </label>
    </div>
  )
}

// One entry in a list waiting to be saved: a recording or a photograph.
export function ReadyItem({
  icon,
  title,
  detail,
  children,
}: {
  icon: string
  title: string
  detail?: string | null
  children: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        background: 'var(--surface-card)',
        boxShadow: '0 0 0 1px var(--cap-line)',
        borderRadius: '12px',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'var(--surface-sunken)',
          color: 'var(--marsh-navy)',
        }}
      >
        <Icon name={icon} size={16} />
      </span>
      <div style={{ flex: '1 1 120px', minWidth: 0 }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        {!!detail && (
          <div
            style={{
              fontSize: '13px',
              lineHeight: '18px',
              color: 'var(--text-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'pre-line',
            }}
          >
            {detail}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

// A photo waiting in the list, shown whole, never cropped: contained in a
// fixed box.
// A waiting photo's thumbnail; with onOpen, it opens the photo full size.
export function PhotoThumb({
  url,
  name,
  onOpen,
}: {
  url: string
  name?: string
  onOpen?: () => void
}) {
  const img = (
    <img
      src={url}
      alt=""
      style={{
        display: 'block',
        width: '64px',
        height: '48px',
        objectFit: 'contain',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '6px',
      }}
    />
  )
  if (!onOpen) return img
  return (
    <button
      type="button"
      aria-label={'Open ' + name}
      onClick={onOpen}
      style={{
        position: 'relative',
        padding: 0,
        border: 0,
        background: 'none',
        cursor: 'zoom-in',
        minHeight: '44px',
      }}
    >
      {img}
      <ZoomBadge small />
    </button>
  )
}

// The round bin beside a waiting item, 44px to tap; `label` names what it removes.
export function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="cap-btn cap-btn--secondary"
      style={{ width: '44px', padding: 0 }}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="trash-2" size={16} />
    </button>
  )
}
