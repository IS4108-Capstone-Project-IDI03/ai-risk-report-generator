// New Observation's optional Severity (CP-24): the four levels as the design system's segmented
// control, each with its symbol and colour. Pressing the chosen one again takes it off, so it can
// be left empty. Called by screens/SiteObservation.tsx; the Checklist tab keeps SeverityPicker.
import { SegmentedControl } from '../../../design-system'
import { SEVERITY_OPTIONS } from '../../site-walk/options'
import '../capture.css'

/** Returns the Severity field; `value` is '' while none is chosen. */
export function CaptureSeverity({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="cap-field cap-sev">
      <span className="cap-label">{'Severity'}</span>
      <SegmentedControl
        ariaLabel="Severity"
        options={SEVERITY_OPTIONS}
        value={value}
        // The chosen one again leaves none chosen.
        onChange={(next) => onChange(next === value ? '' : next)}
      />
    </div>
  )
}
