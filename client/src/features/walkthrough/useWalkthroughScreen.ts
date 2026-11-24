// The one "this screen is showing" call each screen makes (F-12).
// Called near the top of every screen component with a walkthrough. Calls engine.ts (screenShown, screenLeft).
import { useEffect } from 'react'
import { screenLeft, screenShown } from './engine'
import type { Hold } from './state'

/** Tells the engine this screen is showing. `ready` = its data has loaded; `hold` = don't offer now (archived, nothing to show), or 'unsaved' when that is because of unsaved work, which a walkthrough never leaves. `words` fills the screen's own placeholders, e.g. { engineer: 'Alex Rowe' }. Leaving the screen is told by the cleanup. */
export function useWalkthroughScreen(
  screen: string,
  ready: boolean,
  hold?: Hold,
  words?: Record<string, string>,
): void {
  // Compared by value, so a new object each render does not re-run the effect.
  const said = JSON.stringify(words ?? {})
  useEffect(() => {
    screenShown(screen, ready, hold ?? false, JSON.parse(said) as Record<string, string>)
  }, [screen, ready, hold, said])
  // Leaving is told only when the screen key changes or the screen unmounts, not on every ready flip.
  useEffect(() => () => screenLeft(screen), [screen])
}
