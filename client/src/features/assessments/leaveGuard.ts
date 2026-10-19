// A screen with unsaved work can ask to be told before the engineer leaves
// it for another tab or screen (RV-08 AC14). The workspace's tabs and the
// side navigation call guardLeave with what leaving does; while a guard is
// set, it decides: it may ask first, then call `proceed`, or not. Leaving
// the page itself is the browser's beforeunload, set by the screen.
type Guard = (proceed: () => void) => boolean

let guard: Guard | null = null

// Sets the guard; returns a function that removes it again.
export function setLeaveGuard(next: Guard): () => void {
  guard = next
  return () => {
    if (guard === next) guard = null
  }
}

// Leaves at once, unless a guard takes it over (returns true).
export function guardLeave(proceed: () => void) {
  if (guard?.(proceed)) return
  proceed()
}
