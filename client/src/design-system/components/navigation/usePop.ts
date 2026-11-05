// Counts how many times a number has risen since it first showed, so a badge can pop once
// per rise (F-10: the sidebar count and the phone menu dot) and stay still on first paint.
// Called by SideNav and PhoneBar. The key it returns restarts a CSS animation when it changes.
import { useState } from 'react'

/** Returns a number that goes up by one each time `count` rises, starting at 0. */
export function usePop(count: number) {
  // Adjusting state while rendering (not in an effect) is React's way to react to a prop
  // change without an extra render.
  const [seen, setSeen] = useState({ count, pops: 0 })
  if (count !== seen.count) setSeen({ count, pops: seen.pops + (count > seen.count ? 1 : 0) })
  return seen.pops
}
