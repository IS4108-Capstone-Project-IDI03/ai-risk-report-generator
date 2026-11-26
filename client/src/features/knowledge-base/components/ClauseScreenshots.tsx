// A clause's screenshots in the clause editor (IN-18): tables, formulas and
// pictures that can't be typed. Adding one uploads it at once and OCR reads it;
// its text opens in a box to correct before the clause is saved, and the image
// shows beside it. A screenshot not yet saved previews from the browser's copy
// (the gateway shows only those a saved clause holds). Used by
// screens/ManualSections.tsx; uploads through api.ts.
import { useEffect, useRef, useState } from 'react'
import { Icon, IconAction, Select, Textarea, toast } from '../../../design-system'
import { screenshotUrl, uploadScreenshot, type ManualImage, type ManualImageKind } from '../api'

const KINDS: { value: ManualImageKind; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'formula', label: 'Formula' },
  { value: 'picture', label: 'Picture' },
]
const kindName = (kind: ManualImageKind) => KINDS.find((k) => k.value === kind)!.label

/** Returns the Screenshots part of the clause editor. */
export function ClauseScreenshots({
  documentId,
  images,
  context,
  onChange,
}: {
  documentId: string
  images: ManualImage[]
  // The clause's heading trail as typed, sent to help a picture's description.
  context: string
  // Takes a change to the list, applied to the list as it is then: an upload can
  // finish after another edit.
  onChange: (change: (images: ManualImage[]) => ManualImage[]) => void
}) {
  const [kind, setKind] = useState<ManualImageKind>('table')
  const [reading, setReading] = useState(false)
  // A new screenshot's preview (an object URL of the chosen file), and why OCR read nothing.
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [unread, setUnread] = useState<Record<string, string>>({})
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const add = async (file: File) => {
    setReading(true)
    try {
      const shot = await uploadScreenshot(documentId, file, kind, context)
      const preview = URL.createObjectURL(file)
      urls.current.push(preview)
      setPreviews((p) => ({ ...p, [shot.key]: preview }))
      if (shot.readError) setUnread((u) => ({ ...u, [shot.key]: shot.readError! }))
      onChange((list) => [...list, { key: shot.key, kind: shot.kind, text: shot.text }])
    } catch (error: unknown) {
      toast.error('Screenshot not added', {
        description: error instanceof Error ? error.message : 'Try again shortly.',
      })
    } finally {
      setReading(false)
    }
  }

  return (
    <fieldset className="kb-shots">
      <legend>Screenshots</legend>
      {images.map((image, i) => {
        const name = `${kindName(image.kind)} ${i + 1}`
        return (
          <div className="kb-shot" key={image.key}>
            <img
              src={previews[image.key] ?? screenshotUrl(documentId, image.key)}
              alt={name}
              loading="lazy"
            />
            <Textarea
              label={`Text read from ${name.toLowerCase()}`}
              rows={4}
              value={image.text}
              hint={unread[image.key]}
              onChange={(e) =>
                onChange((list) =>
                  list.map((m) => (m.key === image.key ? { ...m, text: e.target.value } : m)),
                )
              }
            />
            <IconAction
              icon="trash-2"
              label={`Remove ${name.toLowerCase()}`}
              tooltip="Remove screenshot"
              danger
              onClick={() => onChange((list) => list.filter((m) => m.key !== image.key))}
            />
          </div>
        )
      })}
      <div className="kb-shot-add">
        <Select
          size="sm"
          label="Screenshot of a"
          options={KINDS}
          value={kind}
          onChange={(e) => setKind(e.target.value as ManualImageKind)}
        />
        <label className="kb-pick" aria-disabled={reading || undefined}>
          <input
            type="file"
            // The gateway reads the type from the bytes and refuses the rest.
            accept="image/png,image/jpeg,image/webp"
            disabled={reading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void add(file)
            }}
          />
          <Icon
            name={reading ? 'loader-circle' : 'image-plus'}
            size={16}
            className={reading ? 'ds-spin' : undefined}
          />
          {reading ? 'Reading the image…' : 'Add screenshot'}
        </label>
      </div>
    </fieldset>
  )
}
