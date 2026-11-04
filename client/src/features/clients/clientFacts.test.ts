// Client facts (CP-23): a client's open count means visits not done, the same
// as the Assessments page's in progress. Tests clientFacts.ts.
import { expect, it } from 'vitest'
import { clientFacts, type FactVisit } from './clientFacts'

const visit = (done: boolean, archived: boolean): FactVisit => ({
  site: 'Tuas',
  surveyDate: '2026-11-12',
  dueDate: null,
  done,
  archived,
})

it('counts a finalised visit as not open', () => {
  const facts = clientFacts([visit(false, false), visit(true, false), visit(true, true)])
  expect(facts.open).toBe(1)
})

it('counts the reports not done whose due day has passed as late', () => {
  const v = (dueDate: string | null, done = false): FactVisit => ({
    site: 'Tuas',
    surveyDate: null,
    dueDate,
    done,
    archived: false,
  })
  const facts = clientFacts(
    [v('2026-10-01'), v('2026-12-01'), v(null), v('2026-09-01', true)],
    '2026-11-03',
  )
  expect(facts.late).toBe(1)
})
