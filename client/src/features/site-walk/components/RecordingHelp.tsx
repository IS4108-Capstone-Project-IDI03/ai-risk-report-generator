// The help (?) on the Recording screen (CP-22 AC2; a dialog until F-13 moved it onto the shared
// help tip): how to record a walk that the AI step reads well. Called by screens/Recording.tsx.
// Calls Tip (features/help).
import { Tip } from '../../help/Tip'

/** Returns the recorder's help (?), with its six lines. */
export function RecordingHelp() {
  return (
    <Tip id="site-walk.recorder" align="right">
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
    </Tip>
  )
}
