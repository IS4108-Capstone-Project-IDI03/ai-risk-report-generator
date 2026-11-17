// What each signed-in person last looked at on the Calendar (CP-60): the view,
// the period and the filters. Kept while the app stays open, so coming Back from
// an assessment finds the same month (design system section 8, "Going back").
// Read and written by screens/Calendar.tsx; tests clear it between cases.
import type { Show, View } from './calendar'

export type KeptView = {
  view: View
  // Any day of the period shown: its month in the month view, its week in the week view.
  day: string
  show: Show
  // An assessment type as shown ("Follow-up"), or '' for any.
  type: string
  // An engineer's id, or '' for any.
  engineer: string
}

// By the person's id, so the next person to sign in on this browser starts afresh.
export const keptViews = new Map<string, KeptView>()
