import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, IconRegistry, Switch } from '../../../design-system'
import type { PhotoRegion, SavedPhoto } from '../api'
import { plural } from '../reviewDisplay'
import { STARTING_MARK } from './markGeometry'
import { ZoomablePhoto } from './ZoomablePhoto'

export type ViewedPhoto = {
  name: string
  url: string
  context?: string
  // How it last went to the AI with protection on (PV-04).
  redaction?: SavedPhoto['redaction']
  // The area the engineer marked (CP-10), and, for whoever may change the
  // observation, a way to save a new mark or (with null) clear it. It throws
  // with the reason to show when the gateway refuses.
  region?: PhotoRegion | null
  mark?: ((region: PhotoRegion | null) => Promise<void>) | null
}

// One photo in a popup over the screen, to zoom into and move around without
// leaving the assessment; nearly the whole window, so detail is visible (CP-22).
// The original shows first, as the evidence; one sent to the AI with faces
// blurred can be switched to that copy (PV-04).
export function PhotoDialog({ photo, onClose }: { photo: ViewedPhoto; onClose: () => void }) {
  const [asSent, setAsSent] = useState(false)
  const blurred = photo.redaction?.url
  // The saved mark, and the one being drawn while marking (CP-10).
  const [region, setRegion] = useState(photo.region ?? null)
  const [draft, setDraft] = useState<PhotoRegion | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const marking = !!draft
  const save = async (next: PhotoRegion | null) => {
    setBusy(true)
    setProblem(null)
    try {
      await photo.mark!(next)
      setRegion(next)
      setDraft(null)
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'The mark could not be saved.')
    } finally {
      setBusy(false)
    }
  }
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
      {!!photo.mark && (
        <div className="photo-mark-actions">
          {marking ? (
            <>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                {'Cancel'}
              </Button>
              <Button variant="primary" size="sm" loading={busy} onClick={() => void save(draft)}>
                {'Save mark'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                iconLeft="crop"
                onClick={() => {
                  setProblem(null)
                  setDraft(region ?? STARTING_MARK)
                }}
              >
                {region ? 'Change mark' : 'Mark area'}
              </Button>
              {!!region && (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="eraser"
                  loading={busy}
                  onClick={() => void save(null)}
                >
                  {'Clear mark'}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {problem && (
        <p className="photo-mark-problem" role="alert">
          {problem}
        </p>
      )}
      <ZoomablePhoto
        src={asSent && blurred ? blurred : photo.url}
        alt={photo.name}
        region={draft ?? region}
        onMark={marking ? setDraft : undefined}
      />
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
