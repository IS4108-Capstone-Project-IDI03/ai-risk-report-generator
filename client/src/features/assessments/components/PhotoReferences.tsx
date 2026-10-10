import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, IconRegistry } from '../../../design-system'
import type { SavedPhoto } from '../api'

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
      {selected &&
        createPortal(
          <Dialog
            title={selected.name}
            description={context}
            width={800}
            onClose={() => setSelected(null)}
          >
            <img
              src={selected.url}
              alt={selected.name}
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
          </Dialog>,
          document.body,
        )}
    </span>
  )
}
