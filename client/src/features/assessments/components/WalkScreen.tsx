// F-12: tells the walkthrough engine that a screen is showing, as a component so a screen can say
// it only while it is the one on show (a hook cannot be called conditionally).
// Called by screens/Observations.tsx. Calls useWalkthroughScreen.
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'

/** Reports `screen` to the engine (`ready` = loaded, `hold` = offer nothing now); draws nothing. */
export function WalkScreen({
  screen,
  ready,
  hold,
}: {
  screen: string
  ready: boolean
  hold?: boolean | 'unsaved'
}) {
  useWalkthroughScreen(screen, ready, hold)
  return null
}
