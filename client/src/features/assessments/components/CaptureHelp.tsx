// The (?) beside Location on the Add manually screen (CP-22 round 2): how
// capture works, in three steps, behind one tap. Called by screens/SiteObservation.tsx.
import { useState } from 'react'
import { Icon, Popover } from '../../../design-system'
import '../capture.css'

export function CaptureHelp({ proposal }: { proposal: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="How to add an observation"
      align="left"
      surfaceClassName="cap-help-menu"
      trigger={
        <button
          type="button"
          className="cap-help"
          aria-label="How to add an observation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="circle-help" size={18} />
        </button>
      }
    >
      <ol className="cap-help-steps">
        <li>Pick the location you are standing in.</li>
        <li>Write a note, record your voice, take photos or scan handwritten pages.</li>
        <li>
          {proposal
            ? 'Choose a category and severity, then add it to the site walk. Nothing reaches the assessment until Create all.'
            : 'Choose its categories and severity, then save. The location stays for the next one.'}
        </li>
      </ol>
    </Popover>
  )
}
