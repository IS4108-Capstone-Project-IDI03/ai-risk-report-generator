// One chosen photo in Appendix A (GN-07): thumbnail, caption field, and its
// move and remove controls. Used by AppendixPhotos.tsx.
import { useState } from 'react'
import { IconButton } from '../../../design-system'
import type { AppendixList } from '../api'

// One chosen photo: thumbnail, caption field (saved when left), and its controls.
export function AppendixRow({
  photo,
  canEdit,
  onUp,
  onDown,
  onRemove,
  onCaption,
}: {
  photo: AppendixList['selected'][number]
  canEdit: boolean
  onUp?: () => void
  onDown?: () => void
  onRemove: () => void
  onCaption: (caption: string) => void
}) {
  const [caption, setCaption] = useState(photo.caption)
  return (
    <li className="rv-appendix-row">
      <img src={photo.url} alt="" />
      <label className="rv-appendix-caption">
        <span className="rv-label">Caption</span>
        <input
          className="rv-appendix-input"
          aria-label={`Caption for ${photo.name}`}
          value={caption}
          maxLength={200}
          disabled={!canEdit}
          onChange={(e) => setCaption(e.target.value)}
          // Only a real change is saved, so tabbing through costs nothing.
          onBlur={() => caption.trim() !== photo.caption && onCaption(caption.trim())}
        />
        <span className="rv-muted">{photo.name}</span>
      </label>
      {canEdit && (
        <span className="rv-appendix-controls">
          <IconButton
            icon="arrow-up"
            label={`Move ${photo.name} up`}
            disabled={!onUp}
            onClick={onUp}
          />
          <IconButton
            icon="arrow-down"
            label={`Move ${photo.name} down`}
            disabled={!onDown}
            onClick={onDown}
          />
          <IconButton
            icon="x"
            label={`Remove ${photo.name} from the appendix`}
            onClick={onRemove}
          />
        </span>
      )}
    </li>
  )
}
