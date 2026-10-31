import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Callout, Dialog, IconButton, Select, Textarea } from '../../../design-system'
import { GatewayError, type ChecklistItem, type SiteLocation } from '../api'
import { categoryLabel } from '../categories'
import { itemTitle } from '../checklistChecks'
import { locationLabel } from '../locations'
import { SeverityPicker } from './SeverityPicker'

const caption: CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-caption-size)',
  color: 'var(--text-secondary)',
}

// Where an answer's observation is saved (CP-31): on site, the location capture
// is in, null until one is chosen; on the Checklist tab, chosen in the box,
// starting from the last one used.
export type AnswerPlace =
  | { kind: 'site'; location: SiteLocation | null; choose: () => void }
  | { kind: 'tab'; locations: SiteLocation[]; last: string | null }

export type Answer = { note: string; severity: string; locationId: string; photos: File[] }

// Confirm or Differs (AC2-3), the same box on the tab and on site: what the
// checklist expects, what was seen, a photo if it helps, and the severity,
// which is always chosen, never assumed (CP-02). Confirm starts from the
// item's own words for the engineer to adjust; Differs starts empty, as only
// the engineer knows what is different. Differs can go to full capture
// instead, for a recording or a handwritten page.
export function AnswerDialog({
  kind,
  item,
  place,
  onClose,
  onSave,
  onFullCapture,
}: {
  kind: 'confirm' | 'differs'
  item: ChecklistItem
  place: AnswerPlace
  onClose: () => void
  onSave: (answer: Answer) => Promise<void>
  onFullCapture: () => void
}) {
  const [note, setNote] = useState(
    kind === 'confirm' ? `Confirmed on site: ${itemTitle(item)}` : '',
  )
  const [severity, setSeverity] = useState('')
  const [locationId, setLocationId] = useState(
    place.kind === 'site'
      ? (place.location?.id ?? '')
      : place.locations.some((l) => l.id === place.last)
        ? place.last!
        : '',
  )
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (!note.trim()) return setError('Write what you saw.')
    if (!locationId) return setError('Choose where you saw it.')
    if (!severity) return setError('Choose a severity first.')
    setSaving(true)
    setError(null)
    try {
      await onSave({ note, severity, locationId, photos })
    } catch (failed: unknown) {
      setSaving(false)
      setError(
        failed instanceof GatewayError
          ? failed.message
          : 'The observation could not be saved. Try again.',
      )
    }
  }
  return (
    <Dialog
      className="ds-dialog-sheet"
      title={kind === 'confirm' ? 'Confirm' : 'Record a difference'}
      description={'Saved as an observation under ' + categoryLabel(item.COPE_dimension) + '.'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" iconLeft="check" loading={saving} onClick={() => void save()}>
            Save observation
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div>
          <p style={caption}>Checklist expects</p>
          <p
            style={{
              margin: 'var(--space-2) 0 0',
              paddingLeft: 'var(--space-4)',
              borderLeft: '2px solid var(--border-default)',
              fontSize: 'var(--text-small-size)',
            }}
          >
            {item.text}
          </p>
        </div>
        <Textarea
          label="What you saw"
          rows={3}
          value={note}
          placeholder={
            kind === 'differs' ? 'e.g. No in-rack sprinklers on racks at 9 m.' : undefined
          }
          onChange={(event) => setNote(event.target.value)}
        />
        {place.kind === 'tab' ? (
          <Select
            label="Where"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            options={[
              { value: '', label: 'Choose a location' },
              ...place.locations.map((l) => ({ value: l.id, label: locationLabel(l) })),
            ]}
          />
        ) : (
          place.location && <p style={caption}>At {locationLabel(place.location)}</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              fontSize: 'var(--text-small-size)',
              color: 'var(--text-link)',
              cursor: 'pointer',
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              aria-label="Add photo"
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])]
                setPhotos((previous) => [...previous, ...chosen])
                event.target.value = ''
              }}
            />
            Add photo
          </label>
          {photos.map((photo, index) => (
            <span
              key={index + photo.name}
              style={{ ...caption, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {photo.name}
              <IconButton
                icon="x"
                size="sm"
                label={'Remove ' + photo.name}
                onClick={() => setPhotos(photos.filter((_, i) => i !== index))}
              />
            </span>
          ))}
        </div>
        <SeverityPicker value={severity} onChange={setSeverity} />
        {kind === 'differs' && (
          <Button
            variant="link"
            size="sm"
            onClick={onFullCapture}
            style={{ alignSelf: 'flex-start' }}
          >
            Use full capture instead, for a recording or handwritten notes
          </Button>
        )}
        {error && (
          <div role="alert">
            <Callout tone="warning" title="Not saved">
              {error}
            </Callout>
          </div>
        )}
      </div>
    </Dialog>
  )
}
