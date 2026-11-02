// The walk's photos so far on the Recording screen (CP-22 round 1): a strip of
// thumbnails, newest last, with a count; tap one to zoom in. Includes photos
// still only on this device. Used by screens/Recording.tsx.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../design-system'
import { PhotoDialog } from '../../assessments/components/PhotoReferences'

type Local = { id: string; blob: Blob }

// Shows saved and device-only photos with a larger preview on tap.
export function PhotoStrip({
  server,
  local,
}: {
  server: { id: string; url: string }[]
  local: Local[]
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

  const urls = [...server.map((p) => p.url), ...localUrls]
  const [shown, setShown] = useState<number | null>(null)
  if (!urls.length) return null

  return (
    <section className="sw-photostrip" aria-label="Photos in this walk">
      <h2>
        <Icon name="camera" size={15} />
        Photos · {urls.length}
      </h2>
      <ul>
        {urls.map((src, i) => (
          <li key={src}>
            <button type="button" aria-label={`Open photo ${i + 1}`} onClick={() => setShown(i)}>
              <img src={src} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {shown !== null && urls[shown] && (
        <PhotoDialog
          photo={{ name: `Photo ${shown + 1} of ${urls.length}`, url: urls[shown] }}
          onClose={() => setShown(null)}
        />
      )}
    </section>
  )
}
