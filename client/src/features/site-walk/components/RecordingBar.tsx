// The Recording screen's top bar (CP-22): the round Back at the left, "Site Walk" centred, and the
// recorder's help (?) at the right when there is one. Drawn in every state of the screen (starting,
// could not start, recording) so Back is always in the same place. Used by screens/Recording.tsx.
import type { ReactNode } from 'react'
import { BackButton } from '../../../design-system'

/** Returns the bar; `help` is the right-hand control, left out where there is nothing to explain. */
export function RecordingBar({
  back,
  onBack,
  help,
}: {
  // The screen Back returns to, read out as "Back to …".
  back: string
  onBack: () => void
  help?: ReactNode
}) {
  return (
    <header className="sw-bar">
      <div className="sw-bar-start">
        <BackButton label={'Back to ' + back} onClick={onBack} />
      </div>
      <h1>Site Walk</h1>
      <div className="sw-bar-end">{help}</div>
    </header>
  )
}
