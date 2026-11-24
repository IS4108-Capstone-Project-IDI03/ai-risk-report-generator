// Says the person just started background work (F-11), so the activity icon
// reads at once instead of at its next 30-second read: a short job (a 4-second
// Regenerate) would otherwise be over before it was ever shown. Called by the
// gateway calls that start a job; heard by useBackgroundWork. Kept outside
// React, like the other open events (assessments/openAssessment.ts).
export const backgroundWorkStarted = { event: 'background-work-started' }

/** Tells the activity icon to read its list again now. */
export function announceBackgroundWork() {
  window.dispatchEvent(new CustomEvent(backgroundWorkStarted.event))
}

/** Returns `call`, announcing background work once the gateway has accepted it. */
export function started<T>(call: Promise<T>): Promise<T> {
  return call.then((value) => {
    announceBackgroundWork()
    return value
  })
}
