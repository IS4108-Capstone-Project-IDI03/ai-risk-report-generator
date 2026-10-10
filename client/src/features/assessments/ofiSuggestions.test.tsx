import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import type { AcceptedOfi, Ofi, OfiList } from './api'
import { OfiRow } from './components/OfiSuggestions'

const REF = 'RPT-2026-0901'
const VALVE = {
  id: 'o1',
  engineer: 'Alex Rowe',
  copeDimensions: ['Protection'],
  standard: null,
  severity: 'critical',
  location: { id: 'l1', name: 'Fire pump room', floor: 'Basement 1' },
  note: 'B1 spk CV found SHUT',
  recordings: [],
  photos: [],
  interpretation: null,
  recordedAt: '2026-09-28T09:00:00.000Z',
  edited: null,
  deleted: null,
  removedRecordings: [],
  removedPhotos: [],
}
const PANEL = { ...VALVE, id: 'o2', severity: 'low', note: 'FA panel ok' }
const SUGGESTION: Ofi = {
  id: 'ofi1',
  title: 'Supervise sprinkler control valves',
  category: 'Physical Protection',
  type: 'Fire Protection System',
  description: 'Supervise control valves in the open position, as per NFPA 25.',
  observation: 'As observed at the Basement 1 fire pump room, the valve was shut.',
  likelihood: 'Likely',
  consequence: 'Major',
  priority: 'Priority 1',
  effort: 'Minor Capital',
  observations: ['o1'],
  standards: ['C:nfpa25:12'],
  precedent: 'P:rep:40',
  precedentReport: 'Shopping Mall Sample 2',
  status: 'New',
  issueDate: '2026-09-28T00:00:00.000Z',
  provenance: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    prompt_version: 'gn05-v4',
    config_version: 'ofi-config-2026-10-08',
    generated_at: '2026-10-08T12:00:00.000Z',
  },
  sources: {
    'C:nfpa25:12': {
      text: 'Control valves shall be supervised.',
      doc_id: 'nfpa25',
      headings: ['Valves'],
      page_start: 12,
    },
    'P:rep:40': {
      text: '2025-02: Description; Formalize Fire Protection System Impairment: As per NFPA 25…',
      doc_id: '6ac21227405acbadf814fae9',
      headings: ['Opportunities for Improvement', 'Management Programs'],
    },
  },
}
const SECOND: Ofi = {
  ...SUGGESTION,
  id: 'ofi2',
  title: 'Improve Hot Work Permit',
  category: 'Management Programs',
  priority: 'Priority 2',
}
const accepted = (o: Ofi, number: string): AcceptedOfi => ({ ...o, number })

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The gateway, keeping the OFIs' states as accepts arrive.
function mockGateway(suggestions: Ofi[]) {
  let list: OfiList = { suggestions, accepted: [] }
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const accept = url.match(/\/ofis\/(\w+)\/accept$/)
    if (accept && init?.method === 'POST') {
      calls.push(accept[1])
      const ofi = list.suggestions.find((o) => o.id === accept[1])!
      list = {
        suggestions: list.suggestions.filter((o) => o !== ofi),
        accepted: [...list.accepted, accepted(ofi, `2026-0${list.accepted.length + 1}`)],
      }
    }
    return json(list)
  })
  return calls
}

function renderRow(canDraft = true) {
  render(<OfiRow reference={REF} canDraft={canDraft} observations={[VALVE, PANEL]} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('is a section row with its state and evidence; a suggestion shows its precedent and stays out of the report (AC2, AC3)', async () => {
  mockGateway([SUGGESTION])
  renderRow()

  // Section 3's row: only moderate-or-worse observations count as its evidence.
  expect(await screen.findByText('1 suggestion to review')).toBeInTheDocument()
  expect(screen.getByText('1 observation')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Redraft OFIs' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'View OFIs' }))

  const card = screen.getByText('Supervise sprinkler control valves').closest('article')!
  expect(within(card).getByText('Priority 1')).toBeInTheDocument()
  expect(within(card).queryByText(/Likely × Major/)).toBeNull()
  // The precedent shows under the box, not inside the draft (AC2).
  expect(within(card).queryByText(/Based on past report/)).toBeNull()
  expect(
    screen.getByText(
      /Based on past report: Shopping Mall Sample 2 · Formalize Fire Protection System Impairment/,
    ),
  ).toBeInTheDocument()
  // It is in the same AI draft box as a section draft, with its sources behind the
  // footer link: the observation, the standard and the past OFI.
  expect(within(card).getByText('AI draft')).toBeInTheDocument()
  // The precedent's report is named by its title, never the knowledge base's id.
  expect(screen.queryByText(/6ac21227405acbadf814fae9/)).toBeNull()
  fireEvent.click(within(card).getByRole('button', { name: /3 sources/ }))
  expect(screen.getByText('Fire pump room, Basement 1')).toBeInTheDocument()
  expect(screen.getByText('Valves')).toBeInTheDocument()
  expect(screen.getByText('p. 12')).toBeInTheDocument()
  expect(screen.getByText('Past report')).toBeInTheDocument()
  expect(
    screen.getByText(/No Opportunities for Improvement are in the report yet/),
  ).toBeInTheDocument()
})

it('accepts several suggestions, one at a time, into the report in report order (AC4)', async () => {
  const calls = mockGateway([SUGGESTION, SECOND])
  renderRow()
  fireEvent.click(await screen.findByRole('button', { name: 'View OFIs' }))

  fireEvent.click(screen.getByRole('button', { name: 'Accept Supervise sprinkler control valves' }))
  await screen.findByText('2026-01')
  fireEvent.click(screen.getByRole('button', { name: 'Accept Improve Hot Work Permit' }))
  await screen.findByText('2026-02')

  expect(calls).toEqual(['ofi1', 'ofi2'])
  const report = screen.getByRole('region', { name: 'Opportunities for Improvement in the report' })
  expect(within(report).getByText('Physical Protection')).toBeInTheDocument()
  expect(within(report).getByText('Management Programs')).toBeInTheDocument()
  expect(within(report).getAllByText('New')).toHaveLength(2)
  expect(within(report).getAllByText('28 Sep 2026')).toHaveLength(2)
  expect(screen.getByText('2 in the report')).toBeInTheDocument()
  // Each category's table has the template's rows: Physical Protection adds the RTM,
  // client, advisory and loss rows, left to be completed; Management Programs doesn't.
  const [management, physical] = within(report).getAllByRole('table')
  expect(within(physical).getByText('Related RTM ID')).toBeInTheDocument()
  expect(within(physical).getByText('Loss scenario')).toBeInTheDocument()
  expect(within(management).queryByText('Loss scenario')).toBeNull()
  // OFI issued by and insurer rec no. are left blank for people to fill.
  expect(within(management).getByText('OFI issued by')).toBeInTheDocument()
  expect(within(management).getByText('Insurer rec no.')).toBeInTheDocument()
  // Loss expectancy as the template lays it out: PD LE, BI LE and TOTAL, amounts blank.
  expect(within(physical).getAllByText('PD LE')).toHaveLength(2)
  expect(within(physical).getAllByText('TOTAL')).toHaveLength(2)
  expect(within(report).queryByText('Marsh')).toBeNull()
})

it('accepts every suggestion at once', async () => {
  const calls = mockGateway([SUGGESTION, SECOND])
  renderRow()
  fireEvent.click(await screen.findByRole('button', { name: 'View OFIs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))

  await screen.findByText('2026-02')
  expect(calls).toEqual(['ofi1', 'ofi2'])
  expect(screen.queryByRole('button', { name: /^Accept / })).toBeNull()
})

it('offers no drafting or accepting to someone who cannot draft', async () => {
  mockGateway([SUGGESTION, SECOND])
  renderRow(false)
  fireEvent.click(await screen.findByRole('button', { name: 'View OFIs' }))
  expect(screen.queryByRole('button', { name: /Draft OFIs|Redraft OFIs/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
})
