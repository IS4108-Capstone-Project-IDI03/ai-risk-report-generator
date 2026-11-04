// What an engineer needs to know about a client at a glance (CP-23): its
// first, last and next survey and the next report due, worked out from the
// engineer's own visits. Called by the Clients table and the client page.

export type FactVisit = {
  site: string
  surveyDate: string | null
  dueDate: string | null
  // Archived or finalised: no longer waiting for a visit or a report.
  done: boolean
  archived: boolean
}

export type ClientFacts = {
  open: number
  // Reports not yet done whose due day has passed.
  late: number
  firstSurvey: string | null
  lastSurvey: string | null
  nextSurvey: { date: string; site: string } | null
  nextDue: { date: string; overdue: boolean } | null
}

// Returns the facts for a client's visits; `today` is an ISO day.
export function clientFacts(
  visits: FactVisit[],
  today = new Date().toLocaleDateString('en-CA'),
): ClientFacts {
  const dated = visits
    .filter((v) => v.surveyDate)
    .sort((a, b) => a.surveyDate!.localeCompare(b.surveyDate!))
  const upcoming = dated.find((v) => !v.archived && v.surveyDate! >= today)
  const due = visits
    .filter((v) => !v.done && v.dueDate)
    .map((v) => v.dueDate!)
    .sort()[0]
  return {
    open: visits.filter((v) => !v.done).length,
    late: visits.filter((v) => !v.done && v.dueDate && v.dueDate < today).length,
    firstSurvey: dated[0]?.surveyDate ?? null,
    lastSurvey: dated.at(-1)?.surveyDate ?? null,
    nextSurvey: upcoming ? { date: upcoming.surveyDate!, site: upcoming.site } : null,
    nextDue: due ? { date: due, overdue: due < today } : null,
  }
}

/** Returns the distinct values, in the order they first appear. */
export const distinct = (values: string[]) => [...new Set(values)]

export type DueState = 'late' | 'soon' | 'ok' | 'none'

/** Returns how a client's next report due stands: late, within 7 days (soon), on track, or not set. */
export function dueState(facts: ClientFacts, today = new Date().toLocaleDateString('en-CA')) {
  if (!facts.nextDue) return 'none' as DueState
  if (facts.nextDue.date < today) return 'late' as DueState
  const days = (Date.parse(facts.nextDue.date) - Date.parse(today)) / 86_400_000
  return (days <= 7 ? 'soon' : 'ok') as DueState
}
