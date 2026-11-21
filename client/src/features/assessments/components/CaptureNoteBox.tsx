// The Note tab's text box on New Observation (CP-02): what was seen, written for the record.
// Called by screens/SiteObservation.tsx.
import { Textarea } from '../../../design-system'

export function CaptureNoteBox({
  value,
  onChange,
  phone,
}: {
  value: string
  onChange: (text: string) => void
  phone: boolean
}) {
  return (
    <Textarea
      aria-label="Note"
      maxLength={5000}
      rows={phone ? 6 : 8}
      placeholder="What did you see? Write as you would for the record."
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
