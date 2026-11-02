// The help (?) sheet on the Recording screen (CP-22 AC2): how to record a walk
// that the AI step reads well.
import { Dialog } from '../../../design-system'

// Explains how to record a site walk for the proposal step.
export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog className="sw-sheet" title="Recording a site walk" width={440} onClose={onClose}>
      <ul>
        <li>Tap Save recording at each pause and start the next one at the next location.</li>
        <li>
          A recording stops by itself at 20 minutes. You hear a tone and see a message a minute
          before.
        </li>
        <li>Type a note between recordings for anything that is easier to write than to say.</li>
        <li>
          Say the building, level and area as you arrive, e.g. “Block A, Level 1, loading bay”.
        </li>
        <li>Photos are matched to what you say around the time you take them.</li>
        <li>
          Keep this screen open. If the phone locks, recording stops, and what you said is kept.
        </li>
      </ul>
    </Dialog>
  )
}
