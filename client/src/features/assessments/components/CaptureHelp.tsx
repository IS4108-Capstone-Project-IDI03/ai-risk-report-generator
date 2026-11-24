// The (?) beside Location on the Add manually screen (CP-22 round 2, moved onto the shared help
// tip in F-13): how capture works, in three steps, behind one tap. Called by LocationSheet.tsx.
// Calls Tip (features/help).
import { Tip } from '../../help/Tip'

/** Returns the capture help (?); `proposal` words the last step for a site walk proposal. */
export function CaptureHelp({ proposal }: { proposal: boolean }) {
  return (
    <Tip id="new-observation.capture" align="left">
      <ol>
        <li>Pick the location you are standing in.</li>
        <li>Write a note, record your voice, take photos or scan handwritten pages.</li>
        <li>
          {proposal
            ? 'Choose a category and severity, then add it to the site walk. Nothing reaches the assessment until Create all.'
            : 'Choose its categories and severity, then save. The location stays for the next one.'}
        </li>
      </ol>
    </Tip>
  )
}
