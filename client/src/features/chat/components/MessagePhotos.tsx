// The photos a question carried, shown with it (CB-08 AC5). Used by components/UserMessage.tsx.
import { photoUrl } from '../api'

/** Thumbnails of the photos sent with a question; nothing when there are none. */
export function MessagePhotos({ ids }: { ids: string[] }) {
  if (!ids.length) return null
  return (
    <div className="message-photos">
      {ids.map((id) => (
        <a key={id} href={photoUrl(id)} target="_blank" rel="noreferrer">
          <img src={photoUrl(id)} alt="Photo you attached" />
        </a>
      ))}
    </div>
  )
}
