import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, IconRegistry } from '../../../design-system'
import type { SavedPhoto } from '../api'
import { ZoomablePhoto } from './ZoomablePhoto'

export type ViewedPhoto = { name: string; url: string; context?: string }

// One photo in a popup over the screen, to zoom into and move around without
// leaving the assessment.
export function PhotoDialog({ photo, onClose }: { photo: ViewedPhoto; onClose: () => void }) {
  return createPortal(
    <Dialog title={photo.name} description={photo.context} width={960} onClose={onClose}>
      <ZoomablePhoto src={photo.url} alt={photo.name} />
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
