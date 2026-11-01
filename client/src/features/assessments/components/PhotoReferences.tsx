import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, IconRegistry, Switch } from '../../../design-system'
import type { SavedPhoto } from '../api'
import { plural } from '../reviewDisplay'
import { ZoomablePhoto } from './ZoomablePhoto'

export type ViewedPhoto = {
  name: string
  url: string
  context?: string
  // How it last went to the AI with protection on (PV-04).
  redaction?: SavedPhoto['redaction']
}

// One photo in a popup over the screen, to zoom into and move around without
// leaving the assessment; nearly the whole window, so detail is visible (CP-22).
// The original shows first, as the evidence; one sent to the AI with faces
// blurred can be switched to that copy (PV-04).
export function PhotoDialog({ photo, onClose }: { photo: ViewedPhoto; onClose: () => void }) {
  const [asSent, setAsSent] = useState(false)
  const blurred = photo.redaction?.url
  return createPortal(
    <Dialog
      title={photo.name}
      description={photo.context}
      width={1400}
      style={{ maxWidth: 'calc(100vw - 24px)' }}
      onClose={onClose}
    >
      {blurred && (
        <Switch
          label={'As sent to AI · ' + plural(photo.redaction!.faces, 'face') + ' blurred'}
          checked={asSent}
          onChange={setAsSent}
          style={{ marginBottom: 'var(--space-5)' }}
        />
      )}
      {photo.redaction && !blurred && (
        // Checked before it went, and nothing to blur: it went as taken.
        <p
          style={{
            margin: '0 0 var(--space-5)',
            fontSize: 'var(--text-caption-size)',
            color: 'var(--text-muted)',
          }}
        >
          {'As sent to AI · no faces found'}
        </p>
      )}
      <ZoomablePhoto src={asSent && blurred ? blurred : photo.url} alt={photo.name} />
    </Dialog>,
    document.body,
  )
}

export function PhotoReferences({ photos, context }: { photos: SavedPhoto[]; context?: string }) {
  const [selected, setSelected] = useState<SavedPhoto | null>(null)
  if (!photos.length) return null
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)' }}>
      {photos.map((photo, index) => (
        <Button
          key={photo.id}
          variant="ghost"
          size="sm"
          iconLeft={IconRegistry.evidence.photo}
          onClick={() => setSelected(photo)}
          style={{
            padding: 0,
            fontSize: 'var(--text-caption-size)',
            color: 'var(--action-primary)',
          }}
        >
          {photos.length === 1 ? 'View photo' : `View photo ${index + 1}`}
        </Button>
      ))}
      {selected && (
        <PhotoDialog photo={{ ...selected, context }} onClose={() => setSelected(null)} />
      )}
    </span>
  )
}
