import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComparisonItem, ComparisonPage, CurrentSource } from './api'
import { SeverityShift } from './ComparisonDetail'
import { ComparisonTab } from './ComparisonTab'
import { filterItems, NO_FILTERS, outcomePill, shownLine } from './comparisonDisplay'

// RV-13: the Comparison tab, from the gateway's answers (a stubbed fetch).

// jsdom has no <dialog> methods; the decision dialogs open with showModal.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const PUMP: CurrentSource = {
  key: 'O:o1',
  kind: 'observation',
  sectionId: null,
  section: 'Observations',
  title: 'Pump room, B1',
  text: 'Fire pump churn pressure 6.9 bar at the weekly test.',
  severity: 'critical',
  priority: null,
  categories: ['Protection'],
  location: 'Pump room, B1',
  finding: null,
  observationId: 'o1',
  current: true,
}
const SHUTTER: CurrentSource = {
  ...PUMP,
  key: 'O:o2',
  title: 'Warehouse, Level 1',
  text: 'Roller shutter in the fire wall jammed open.',
  severity: 'high',
  location: 'Warehouse, Level 1',
  observationId: 'o2',
}

const item = (extra: Partial<ComparisonItem>): ComparisonItem => ({
  key: 'P:9:0.0',
  kind: 'previous',
  previous: {
    key: 'P:9:0.0',
    kind: 'finding',
    sectionId: '9',
    section: '9. Fire Protection',
    heading: 'Water Supply Details',
    quote: 'The fire pump churn pressure was 7.5 bar at the weekly test.',
    context: null,
    severity: 'high',
    priority: null,
    categories: ['Protection'],
    location: 'Pump room, B1',
  },
  source: null,
  outcome: 'worse',
  suggested: 'worse',
  sources: ['O:o1'],
  disagree: [],
  possible: [],
  reason: 'The churn pressure was lower at this survey.',
  missing: null,
  confidence: 'high',
  figures: [
    {
      name: 'Churn pressure',
      previous: '7.5 bar',
      current: '6.9 bar',
      source: 'O:o1',
      difference: '−0.6 bar',
      note: null,
    },
  ],
  severity: { previous: 'High', current: 'Critical', direction: 1 },
  corrections: [],
  decided: null,
  dismissed: false,
  recheck: null,
  categories: ['Protection'],
  locations: ['Pump room, B1'],
  level: 'critical',
  ...extra,
})

const WORSE = item({})
const NEW = item({
  key: 'N:O:o2',
  kind: 'new',
  previous: null,
  source: 'O:o2',
  outcome: 'new',
  suggested: 'new',
  sources: ['O:o2'],
  reason: null,
  figures: [],
  severity: null,
  locations: ['Warehouse, Level 1'],
  level: 'high',
})
const NOT_CHECKED = item({
  key: 'P:9:0.1',
  previous: {
    ...WORSE.previous!,
    key: 'P:9:0.1',
    quote: 'The sprinkler valve was chained but not locked.',
  },
  outcome: 'not_checked',
  suggested: 'not_checked',
  sources: [],
  reason: null,
  missing: 'No observation records the sprinkler control valves.',
  figures: [],
  severity: null,
  level: 'high',
})

const PREVIOUS = {
  reference: 'RPT-2025-0410',
  siteVisitDate: '2025-04-10T12:00:00.000Z',
  engineer: 'Alex Rowe',
}

const page = (extra: Partial<ComparisonPage> = {}): ComparisonPage => ({
  reference: 'RPT-2026-0801',
  previousReports: [PREVIOUS],
  previous: PREVIOUS,
  canChange: true,
  readOnly: null,
  observations: 2,
  comparison: {
    id: 'c1',
    previous: PREVIOUS,
    ranAt: '2026-11-24T12:00:00.000Z',
    ranBy: { id: 'u1', name: 'Alex Rowe' },
    items: [WORSE, NEW, NOT_CHECKED],
    counts: {
      fixed: 0,
      improved: 0,
      unchanged: 0,
      worse: 1,
      not_checked: 1,
      new: 1,
      undecided: 0,
      dismissed: 0,
      total: 3,
    },
    summary: '1 worse, 1 new, 1 not checked',
    sources: [PUMP, SHUTTER],
    outOfDate: null,
    privacy: { enabled: true, masked_count: 3 },
  },
  failure: null,
  running: false,
  ...extra,
})

type Call = { method: string; url: string; body: unknown }
function gateway(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const { status = 200, body } = answer(call)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return calls
}

const show = () =>
  render(
    <ComparisonTab reference="RPT-2026-0801" onViewObservation={vi.fn()} onOpenSection={vi.fn()} />,
  )

describe('The Comparison tab (RV-13)', () => {
  it('names the report it compares with, and the counts', async () => {
    gateway(() => ({ body: page() }))

    show()

    expect(
      await screen.findByText(/RPT-2025-0410 · visited 10 Apr 2025 · lead engineer Alex Rowe/),
    ).toBeInTheDocument()
    expect(screen.getByText('1 worse, 1 new, 1 not checked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compare again' })).toBeInTheDocument()
    expect(screen.getByText('Showing 3 items')).toBeInTheDocument()
  })

  it('says when the site has no earlier finalised report, and when one becomes available', async () => {
    gateway(() => ({ body: page({ previousReports: [], previous: null, comparison: null }) }))

    show()

    expect(await screen.findByText('No earlier finalised report for this site')).toBeInTheDocument()
    expect(
      screen.getByText(
        /becomes available once an earlier assessment of this site has its report finalised/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull()
  })

  it('greys out Compare until an observation is saved', async () => {
    gateway(() => ({ body: page({ comparison: null, observations: 0 }) }))

    show()

    const compare = await screen.findByRole('button', { name: /Compare with previous report/ })
    expect(compare).toHaveAttribute('aria-disabled', 'true')
  })

  it('runs the comparison against the report shown', async () => {
    const calls = gateway((call) =>
      call.method === 'POST' ? { status: 201, body: page() } : { body: page({ comparison: null }) },
    )
    show()

    fireEvent.click(await screen.findByRole('button', { name: 'Compare with previous report' }))

    expect(await screen.findByText('1 worse, 1 new, 1 not checked')).toBeInTheDocument()
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/assessments/RPT-2026-0801/comparison',
      body: { previous: 'RPT-2025-0410' },
    })
  })

  it('states a failed run’s cause and time, offers Retry, and keeps the last comparison', async () => {
    gateway((call) =>
      call.method === 'POST'
        ? {
            status: 503,
            body: {
              error: 'The language model could not be reached.',
              failedAt: '2026-11-24T06:02:00.000Z',
            },
          }
        : { body: page() },
    )
    show()

    fireEvent.click(await screen.findByRole('button', { name: 'Compare again' }))

    expect(await screen.findByText(/^Comparison stopped at \d\d:\d\d$/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'The language model could not be reached. The last comparison is still shown.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByText('1 worse, 1 new, 1 not checked')).toBeInTheDocument()
  })

  it('shows both sides of an item: the previous words with their section, and the current evidence', async () => {
    gateway(() => ({ body: page() }))

    show()

    const panel = await screen.findByRole('article', { name: 'Comparison item' })
    expect(
      within(panel).getByText('The fire pump churn pressure was 7.5 bar at the weekly test.'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('9. Fire Protection · Water Supply Details')).toBeInTheDocument()
    expect(
      within(panel).getByText('Fire pump churn pressure 6.9 bar at the weekly test.'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('button', { name: 'Open Observation · Pump room, B1' }),
    ).toBeInTheDocument()
    expect(within(panel).getByText('High confidence')).toBeInTheDocument()
    expect(within(panel).getByText('−0.6 bar')).toBeInTheDocument()
    expect(within(panel).getByText(/Suggested by the comparison/)).toBeInTheDocument()
  })

  it('says what evidence is missing for an item not checked', async () => {
    gateway(() => ({ body: page() }))
    show()

    fireEvent.click(await screen.findByText('The sprinkler valve was chained but not locked.'))

    expect(
      await screen.findByText('No observation records the sprinkler control valves.'),
    ).toBeInTheDocument()
  })

  it('filters by outcome and always says how many are shown', async () => {
    gateway(() => ({ body: page() }))
    show()

    fireEvent.click(await screen.findByRole('button', { name: '1 New' }))

    expect(screen.getByText('Showing 1 of 3 items')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Comparison items' })).getAllByRole('button'),
    ).toHaveLength(1)
  })

  it('saves the engineer’s decision, and the AI marking turns neutral', async () => {
    const decided = item({
      decided: {
        action: 'accept',
        by: { id: 'u1', name: 'Alex Rowe' },
        at: '2026-11-24T12:05:00.000Z',
        note: null,
        carried: false,
      },
    })
    const calls = gateway((call) =>
      call.method === 'POST'
        ? {
            body: page({
              comparison: { ...page().comparison!, items: [decided, NEW, NOT_CHECKED] },
            }),
          }
        : { body: page() },
    )
    show()
    const panel = await screen.findByRole('article', { name: 'Comparison item' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))

    expect(await screen.findByText('Accepted by Alex Rowe on 24 Nov 2026')).toBeInTheDocument()
    // Accepted, there is nothing left to accept.
    expect(within(panel).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/assessments/RPT-2026-0801/comparison/c1/items/P%3A9%3A0.0/decision',
      body: { action: 'accept' },
    })
  })

  it('needs a note to set Fixed with no current source', async () => {
    const calls = gateway(() => ({ body: page() }))
    show()
    fireEvent.click(await screen.findByText('The sprinkler valve was chained but not locked.'))
    fireEvent.click(await screen.findByRole('button', { name: 'Change outcome' }))

    fireEvent.click(screen.getByLabelText('Fixed'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Add a short note saying how you know it was fixed.'),
    ).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('re-pairing a Not checked item with evidence starts it at Unchanged, never Worse', async () => {
    const calls = gateway(() => ({ body: page() }))
    show()
    fireEvent.click(await screen.findByText('The sprinkler valve was chained but not locked.'))
    fireEvent.click(await screen.findByRole('button', { name: 'Re-pair' }))

    fireEvent.click(screen.getByRole('checkbox', { name: /Roller shutter in the fire wall/ }))

    expect(screen.getByRole('combobox', { name: 'Outcome' })).toHaveValue('unchanged')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(calls.at(-1)).toMatchObject({
        method: 'POST',
        body: { action: 'pair', sources: ['O:o2'], outcome: 'unchanged' },
      }),
    )
  })

  it('drops the Dismissed filter once its last item is restored', async () => {
    const dismissed = { ...NEW, dismissed: true }
    const counts = { ...page().comparison!.counts, new: 0, dismissed: 1 }
    const restored = page()
    gateway((call) =>
      call.method === 'POST'
        ? { body: restored }
        : {
            body: page({
              comparison: { ...page().comparison!, items: [WORSE, dismissed, NOT_CHECKED], counts },
            }),
          },
    )
    show()
    fireEvent.click(await screen.findByRole('button', { name: '1 Dismissed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    expect(await screen.findByText('Showing 3 items')).toBeInTheDocument()
    expect(screen.queryByText('No item matches these filters.')).toBeNull()
  })

  it('is read only for anyone but the assigned engineer', async () => {
    gateway(() => ({ body: page({ canChange: false, readOnly: 'not_assigned' }) }))

    show()

    expect(await screen.findAllByText('View only')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull()
  })

  it('says what changed once it is out of date', async () => {
    gateway(() => ({
      body: page({
        comparison: {
          ...page().comparison!,
          outOfDate: {
            summary: '1 observation added and 1 retagged',
            changes: [
              { kind: 'observation', change: 'added', label: 'Pump room, B1: Hose reel blocked.' },
              { kind: 'observation', change: 'retagged', label: 'Pump room, B1: Fire pump churn…' },
            ],
          },
        },
      }),
    }))

    show()

    expect(
      await screen.findByText(/^1 observation added and 1 retagged since this comparison ran\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Added: Pump room, B1: Hose reel blocked.')).toBeInTheDocument()
  })
})

describe('Comparison display rules', () => {
  it('hides dismissed items unless asked for them', () => {
    const items = [WORSE, { ...NEW, dismissed: true }]

    expect(filterItems(items, NO_FILTERS).map((i) => i.key)).toEqual(['P:9:0.0'])
    expect(filterItems(items, { ...NO_FILTERS, outcome: 'dismissed' }).map((i) => i.key)).toEqual([
      'N:O:o2',
    ])
    expect(filterItems(items, { ...NO_FILTERS, location: 'Warehouse, Level 1' })).toEqual([])
  })

  it('shows one severity when both reports agree, and the move when they differ', () => {
    render(
      <>
        <SeverityShift severity={{ previous: 'Low', current: 'Low', direction: 0 }} />
        <SeverityShift severity={{ previous: 'High', current: 'Critical', direction: 1 }} />
      </>,
    )
    expect(screen.queryByText(/Low.*Low/)).toBeNull()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText(/High/).textContent).toBe('High →  to Critical')
  })

  it('marks a suggestion in AI violet and a decision in neutral', () => {
    expect(outcomePill(WORSE)).toMatchObject({ label: 'Worse', tone: 'ai' })
    expect(
      outcomePill({
        ...WORSE,
        decided: {
          action: 'accept',
          by: { id: 'u', name: 'A' },
          at: '',
          note: null,
          carried: false,
        },
      }).tone,
    ).toBe('neutral')
    expect(outcomePill({ ...WORSE, outcome: null }).label).toBe('Sources disagree')
    expect(shownLine(1, 1)).toBe('Showing 1 item')
  })
})
