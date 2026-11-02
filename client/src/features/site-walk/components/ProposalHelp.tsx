// The (?) beside Create all on a proposal's review (CP-22 round 3): how a
// review works, in three steps, behind one tap. The same popover as Add
// manually's (assessments/components/CaptureHelp.tsx). Used by ProposalHeader.tsx.
import { useState } from 'react'
import { Icon, Popover } from '../../../design-system'
import '../../assessments/capture.css'

export function ProposalHelp() {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="How to review a proposal"
      align="right"
      surfaceClassName="cap-help-menu"
      trigger={
        <button
          type="button"
          className="cap-help swr-help"
          aria-label="How to review a proposal"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="circle-help" size={20} />
        </button>
      }
    >
      <ol className="cap-help-steps">
        <li>Go through each location. A red mark shows what an observation still needs.</li>
        <li>Change, add or delete locations and observations. Every edit saves as you go.</li>
        <li>Press Create all to add everything to the assessment. Until then, none of it is.</li>
      </ol>
    </Popover>
  )
}
