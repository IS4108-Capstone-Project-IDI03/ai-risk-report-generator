// The photo button in the chat box and the tray under it (CB-08): choose up to 3 JPG or PNG photos
// (8 MB each), see each one, choose what to do about faces, and remove any. Uploading checks the
// faces at once, so the choice is made before sending. Drawn inside AgentInterface
// (screens/KnowledgeAssistant.tsx). Calls api.ts; the chosen photos go out with the next question.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IconButton } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { removeChatPhoto, uploadChatPhoto } from '../api'
import {
  addPending,
  removePending,
  updatePending,
  usePending,
  type PendingPhoto,
} from '../photoStore'
import { asProblem, type Problem } from '../speech'
import { FaceChoice } from './FaceChoice'
import { useComposerHosts } from './useComposerHosts'
import { photoUrl } from '../api'

const MAX_PHOTOS = 3
const MAX_BYTES = 8 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png']

/** Photo button, thumbnails and the face choice for the question being written. */
export function PhotoAttach() {
  const items = usePending()
  const { card, below } = useComposerHosts()
  const [note, setNote] = useState<Problem | null>(null)
  // Photos still being stored and checked; they count toward the limit.
  const [busy, setBusy] = useState(0)
  const picker = useRef<HTMLInputElement>(null)

  const add = async (files: File[]) => {
    setNote(null)
    for (const file of files) {
      const refusal = refuse(file, items.length + busy)
      if (refusal) {
        setNote(refusal)
        continue
      }
      setBusy((n) => n + 1)
      try {
        const stored = await uploadChatPhoto(file)
        addPending({
          ...stored,
          key: stored.id,
          name: file.name,
          choice: 'blur',
          preview: URL.createObjectURL(file),
        })
      } catch (error) {
        setNote(
          asProblem(error instanceof GatewayError ? error.message : 'Could not add that photo.'),
        )
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }
  const remove = (photo: PendingPhoto) => {
    removePending(photo.key)
    void removeChatPhoto(photo.id).catch(() => {})
  }

  const button = (
    <div className="photo-attach">
      <IconButton
        icon="image-plus"
        label="Attach a photo"
        disabled={items.length + busy >= MAX_PHOTOS}
        onClick={() => picker.current?.click()}
      />
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])])
          // So choosing the same file again still fires a change.
          e.target.value = ''
        }}
      />
    </div>
  )
  const tray = (items.length > 0 || busy > 0 || note) && (
    <div className="photo-tray">
      {items.map((photo) => (
        <div key={photo.key} className="photo-tray__item">
          <img
            src={
              photo.faces && photo.choice === 'blur' && photo.blurredId
                ? photoUrl(photo.blurredId)
                : photo.preview
            }
            alt={photo.name}
          />
          {photo.faces > 0 && (
            <FaceChoice
              faces={photo.faces}
              value={photo.choice}
              onChange={(choice) => updatePending(photo.key, { choice })}
            />
          )}
          <IconButton
            icon="x"
            label={`Remove photo ${photo.name}`}
            tooltip="Remove photo"
            onClick={() => remove(photo)}
          />
        </div>
      ))}
      {busy > 0 && (
        <p className="voice-input__state" role="status">
          Checking photo…
        </p>
      )}
      {note && (
        <p className="voice-input__note" role="alert">
          <Icon name="circle-alert" size={16} />
          <strong>{note.problem}</strong>
          {note.fix && <span>{note.fix}</span>}
        </p>
      )}
    </div>
  )
  return (
    <>
      {card && createPortal(button, card)}
      {below && tray && createPortal(tray, below)}
    </>
  )
}

// Why a file cannot be added, in design system v2's wording (short problem, then the fix); null if it can.
function refuse(file: File, already: number): Problem | null {
  if (already >= MAX_PHOTOS) return { problem: 'Up to 3 photos', fix: 'Remove one to add another.' }
  if (!TYPES.includes(file.type))
    return { problem: 'Only JPG and PNG', fix: `${file.name} was not added.` }
  if (file.size > MAX_BYTES) return { problem: 'Over 8 MB', fix: `${file.name} was not added.` }
  return null
}
