// EV-01: the Evidence checks card on the Validation and export tab.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

const REF = 'RPT-2026-0001'
const RECORD = {
  id: '6ab39003058299a45f20c9d4',
  reference: REF,
  client: 'Straits Logistics',
  policyReference: null,
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-04-21',
  reportDueDate: '2026-05-02',
  standards: ['FM Global 2-0'],
  engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
  status: 'draft',
  captureStartedAt: '2026-09-23T09:05:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  site: { code: 'SITE-0001', name: 'Jurong Distribution Hub', address: null, jurisdiction: 'SG', facilityType: 'Distribution warehouse' },
}
const RUN = {
  _id: 'r1',
  createdAt: '2026-10-09T01:00:00.000Z',
  summary: { passed: 1, failed: 1, warned: 0, unverified: 0, status: 'failed' },
  checks: [
    { sectionId: '7', check: 'finding-has-evidence', target: 'Construction Narrative #2', result: 'fail', detail: 'No citation' },
    { sectionId: '7', check: 'citation-resolves', target: 'O:o1', result: 'pass' },
  ],
}
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows Run checks on the Validation and export tab and lists the results', async () => {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/assessments') return json(200, [RECORD])
    if (url === `/api/assessments/${REF}/evaluation`)
      return init?.method === 'POST' ? json(201, RUN) : json(404, { error: 'none' })
    return json(200, [])
  })
  render(<App />)
  await signIn()
  const row = (await screen.findAllByRole('button', { name: /Jurong Distribution Hub/ })).find(
    (b) => b.getAttribute('data-id') === REF,
  )!
  fireEvent.click(row)
  fireEvent.click(screen.getByRole('tab', { name: /^Validation/ }))

  fireEvent.click(await screen.findByRole('button', { name: 'Run checks' }))
  expect(await screen.findByText(/Construction Narrative #2/)).toBeInTheDocument()
  expect(screen.getByText(/1 passed · 1 failed/)).toBeInTheDocument()
}, 15_000)
