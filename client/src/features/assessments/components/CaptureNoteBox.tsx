// The Note tab's text box on New Observation (CP-02): what was seen, written for the record.
// With a live assessment's `reference` it can be dictated into (CP-27), as the saved
// observation's Note card can. Called by screens/SiteObservation.tsx.
import { useRef } from 'react'
import { Textarea } from '../../../design-system'
import { DictateButton } from '../dictation/DictateButton'

export function CaptureNoteBox({
  value,
  onChange,
  phone,
  reference,
  onBlur,
}: {
  value: string
  onChange: (text: string) => void
  phone: boolean
  // Null until the capture session is live, or for a site walk proposal: nothing to dictate into.
  reference: string | null
  // Called with the note when the engineer leaves the box (the tag picker's cue to suggest).
  onBlur?: (text: string) => void
}) {
  // Holds the text box, for dictation to find: the shared Textarea takes no ref.
  const box = useRef<HTMLDivElement>(null)
  // The mic sits in the box's bottom-right corner, as in a message composer, so it costs no row.
  return (
    <div ref={box} className="cap-note" data-walk="new-observation.note">
      <Textarea
        aria-label="Note"
        maxLength={5000}
        rows={phone ? 6 : 5}
        placeholder="What did you see? Write as you would for the record."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
      />
      {reference && (
        <DictateButton
          reference={reference}
          field={() => box.current?.querySelector('textarea')}
          onChange={onChange}
        />
      )}
    </div>
  )
}
