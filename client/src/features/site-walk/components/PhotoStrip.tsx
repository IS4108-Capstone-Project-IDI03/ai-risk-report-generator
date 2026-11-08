// The walk's photos on the Recording screen (CP-22 round 1, Sprint 4 fixes AC3-AC6): a
// grid as wide as the recording box, newest last, a dashed Add photo tile at the end and a
// remove button on each. Includes photos still only on this device. Used by screens/Recording.tsx.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { PhotoDialog } from '../../assessments/components/PhotoReferences'
import { PHOTO_ACCEPT } from '../uploadTypes'
import '../photoStrip.css'

type Local = { id: string; blob: Blob }

// Shows saved and device-only photos, a larger preview on tap, Add photo and remove.
export function PhotoStrip({
  server,
  local,
  onAdd,
  onRemove,
}: {
  server: { id: string; url: string }[]
  local: Local[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}) {
  // A photo taken on this device has no URL yet, so it gets a temporary one.
  const blobs = local.map((p) => p.blob)
  const blobKey = local.map((p) => p.id).join()
  const localUrls = useMemo(
    () => blobs.map((b) => URL.createObjectURL(b)),
    // Rebuilt only when the set of photos changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blobKey],
  )
  // Frees them when the set changes or the screen closes.
  useEffect(() => () => localUrls.forEach((u) => URL.revokeObjectURL(u)), [localUrls])

  const tiles = [
    ...server.map((p) => ({ id: p.id, src: p.url })),
    ...local.map((p, i) => ({ id: p.id, src: localUrls[i] })),
  ]
  const [shown, setShown] = useState<number | null>(null)
  // Previews the browser can't draw (a HEIC in Chrome) wait quietly for the server's copy.
  const [undrawn, setUndrawn] = useState<Set<string>>(new Set())
  const picker = useRef<HTMLInputElement>(null)

  return (
    <section className="sw-photostrip" aria-label="Photos in this walk">
      <h2>
        <Icon name="camera" size={15} />
        Photos{tiles.length ? ` · ${tiles.length}` : ''}
      </h2>
      <ul>
        {tiles.map((tile, i) => (
          <li key={tile.src}>
            {undrawn.has(tile.src) ? (
              <span
                className="sw-photo-open sw-photo-wait"
                role="img"
                aria-label={`Photo ${i + 1}, getting ready`}
              >
                <Icon name="loader-circle" size={20} className="sw-spin" />
              </span>
            ) : (
              <button
                type="button"
                className="sw-photo-open"
                aria-label={`Open photo ${i + 1}`}
                onClick={() => setShown(i)}
              >
                <img
                  src={tile.src}
                  alt=""
                  loading="lazy"
                  onError={() => setUndrawn((s) => new Set(s).add(tile.src))}
                />
              </button>
            )}
            <button
              type="button"
              className="sw-photo-remove"
              aria-label={`Remove photo ${i + 1}`}
              title="Remove photo"
              onClick={() => onRemove(tile.id)}
            >
              <Icon name="trash-2" size={14} />
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="sw-photo-add" onClick={() => picker.current?.click()}>
            <Icon name="plus" size={22} />
            Add photo
          </button>
        </li>
      </ul>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        accept={PHOTO_ACCEPT}
        aria-label="Choose photos"
        onChange={(e) => {
          onAdd([...(e.target.files ?? [])])
          // Cleared so picking the same file again still fires.
          e.target.value = ''
        }}
      />
      {shown !== null && tiles[shown] && (
        <PhotoDialog
          photo={{ name: `Photo ${shown + 1} of ${tiles.length}`, url: tiles[shown].src }}
          onClose={() => setShown(null)}
        />
      )}
    </section>
  )
}
