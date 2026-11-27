import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientInsights, InsightSite, InsightSummary } from './api'
import { InsightsTab } from './screens/InsightsTab'

// CP-29: the client page's Insights tab, from the gateway's figures (a stubbed fetch).

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const cells = (counts: number[], critical = 0, high = 0) =>
  ['Construction', 'Occupancy', 'Protection', 'Exposure', null].map((category, i) => ({
    category,
    count: counts[i],
    critical: category === 'Protection' ? critical : 0,
    high: category === 'Protection' ? high : 0,
  }))

const TILBURY: InsightSite = {
  id: 's1',
  name: 'Tilbury Distribution Centre',
  facilityType: 'Warehouse',
  jurisdiction: 'UK',
  reference: 'RPT-2026-0411',
  siteVisitDate: '2026-09-18',
  status: 'under_review',
  observations: 14,
  critical: 3,
  high: 4,
  uncategorised: 0,
  cells: cells([2, 4, 7, 1, 0], 2, 3),
  ofis: { accepted: 6, priority1: 2, priority2: 2 },
  rating: { score: 48.6, rating: 'D' },
  reasons: [
    { text: '3 Critical findings', tone: 'danger' },
    { text: 'Rated D', tone: 'warn' },
    { text: 'Worse since first visit', tone: 'warn' },
  ],
  visits: [
    {
      reference: 'RPT-2025-0107',
      siteVisitDate: '2025-03-12',
      surveyType: 'First survey',
      observations: 9,
      criticalHigh: 5,
      ofis: 4,
      score: 52.9,
      rating: 'C',
    },
    {
      reference: 'RPT-2026-0411',
      siteVisitDate: '2026-09-18',
      surveyType: 'Resurvey',
      observations: 14,
      criticalHigh: 7,
      ofis: 6,
      score: 48.6,
      rating: 'D',
    },
  ],
  change: 'worse',
}
const TUAS: InsightSite = {
  ...TILBURY,
  id: 's2',
  name: 'Tuas Logistics Hub',
  jurisdiction: 'SG',
  reference: 'RPT-2026-0438',
  observations: 8,
  critical: 0,
  high: 2,
  cells: cells([2, 2, 3, 1, 0], 0, 1),
  ofis: { accepted: 3, priority1: 0, priority2: 2 },
  rating: null,
  reasons: [
    { text: '2 High findings', tone: 'warn' },
    { text: 'Rating not entered', tone: 'neutral' },
  ],
  visits: [{ ...TILBURY.visits[1], reference: 'RPT-2026-0438', criticalHigh: 2, score: null }],
  change: null,
}

function insights(overrides: Partial<ClientInsights> = {}): ClientInsights {
  return {
    rulesVersion: 'insights-v1',
    empty: false,
    totals: {
      sites: 2,
      assessments: 3,
      observations: 22,
      uncategorised: 0,
      critical: 3,
      high: 6,
      ofisAccepted: 9,
      ofisPriority12: 6,
      reportsLate: 1,
      latest: { site: 'Tuas Logistics Hub', days: 5 },
    },
    byCategory: cells([4, 6, 10, 2, 0], 2, 4),
    sites: [TILBURY, TUAS],
    findings: [
      {
        kind: 'category',
        tone: 'neutral',
        title: 'Protection is the most common category',
        detail: '10 of 22 observations, found at all 2 sites.',
        siteId: null,
        category: 'Protection',
        share: { count: 10, total: 22 },
        change: null,
      },
      {
        kind: 'worse',
        tone: 'danger',
        title: 'Tilbury Distribution Centre got worse between visits',
        detail: 'Critical and High findings rose from 5 to 7, and its rating fell from C to D.',
        siteId: 's1',
        category: null,
        share: null,
        change: { from: 5, to: 7, period: 'Mar 2025 to Sep 2026' },
      },
    ],
    summary: null,
    canSummarise: true,
    ...overrides,
  }
}

const SUMMARY: InsightSummary = {
  id: 'sum1',
  statements: [
    { text: 'Fire protection is the main concern across the client.', citations: [1] },
    { text: 'At Tilbury an in-rack sprinkler valve was found closed.', citations: [2, 1] },
  ],
  missing: 'Tuas Logistics Hub has no rating yet.',
  confidence: 'medium',
  sources: [
    {
      n: 1,
      kind: 'figure',
      title: "Observations by category, at each site's latest assessment",
      meta: null,
      quote: 'Across 2 sites: Protection 10 (22 observations).',
      observationId: null,
      reference: null,
    },
    {
      n: 2,
      kind: 'observation',
      title: 'Tilbury Distribution Centre · High-bay racking, Aisle 14',
      meta: 'Critical · 18 Sep 2026',
      quote: 'In-rack sprinkler valve found closed and untagged.',
      observationId: 'o1',
      reference: 'RPT-2026-0411',
    },
  ],
  basis: { observations: 22, ofis: 9, ratings: 1 },
  writtenAt: '2026-11-15T10:12:00.000Z',
  outOfDate: false,
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The gateway: the insights as given, and each summary write answered by `write`.
function gateway(
  current: ClientInsights | (() => Promise<Response>),
  write: () => Promise<Response> = () => json(SUMMARY, 201),
) {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const call = `${init?.method ?? 'GET'} ${url}`
    calls.push(call)
    if (call === 'GET /api/clients/c1/insights')
      return typeof current === 'function' ? current() : json(current)
    if (call === 'POST /api/clients/c1/insights/summary') return write()
    throw new Error(`Unexpected call: ${call}`)
  })
  return calls
}

async function open(onOpen = vi.fn()) {
  render(<InsightsTab clientId="c1" onOpen={onOpen} />)
  await screen.findByRole('heading', { name: 'Sites needing attention' })
  return onOpen
}

const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^\\d${name}`) })

describe('Insights tab (CP-29)', () => {
  it('shows the headline figures and what stands out', async () => {
    gateway(insights())
    await open()

    // "Critical and High" also names a measure of the change chart.
    const tiles = within(document.querySelector('.ci-tiles') as HTMLElement)
    const tile = (label: string) => tiles.getByText(label).closest('.ci-tile') as HTMLElement
    expect(within(tile('Sites')).getByText('2')).toBeVisible()
    expect(within(tile('Sites')).getByText('3 assessments')).toBeVisible()
    expect(within(tile('Critical and High')).getByText('9')).toBeVisible()
    expect(within(tile('Critical and High')).getByText('3 Critical')).toBeVisible()
    expect(within(tile('Priority 1 and 2 OFIs')).getByText('of 9 accepted')).toBeVisible()
    expect(within(tile('Reports late')).getByText('Tuas Logistics Hub, 5 days')).toBeVisible()

    expect(
      screen.getByRole('heading', { name: 'Protection is the most common category' }),
    ).toBeVisible()
    expect(screen.getByText('10 of 22 observations, found at all 2 sites.')).toBeVisible()
    expect(screen.getByRole('img', { name: '10 of 22 observations' })).toBeVisible()
  })

  it('lists the sites worst first with their reasons, and opens a site\u2019s assessment', async () => {
    gateway(insights())
    const onOpen = await open()

    // Worst first, as the gateway orders them.
    const names = [...document.querySelectorAll('.ci-rank-name')].map((n) => n.textContent)
    expect(names).toEqual(['Tilbury Distribution Centre', 'Tuas Logistics Hub'])
    const tilbury = row('Tilbury Distribution Centre')
    expect(within(tilbury).getByText('Warehouse · United Kingdom')).toBeVisible()
    expect(within(tilbury).getByText('3 Critical findings')).toBeVisible()
    expect(within(tilbury).getByText('Rated D')).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open RPT-2026-0411 at Tilbury Distribution Centre',
      }),
    )
    expect(onOpen).toHaveBeenCalledWith('RPT-2026-0411', 'Tilbury Distribution Centre')
  })

  it('keeps a chosen site lit in the grid and the change chart', async () => {
    gateway(insights())
    await open()

    fireEvent.click(row('Tuas Logistics Hub'))

    expect(row('Tuas Logistics Hub')).toHaveAttribute('aria-pressed', 'true')
    const grid = screen.getByRole('table', { name: /by COPE category/ })
    expect(within(grid).getByRole('row', { name: /^Tilbury/ })).toHaveAttribute('data-dim')
    expect(within(grid).getByRole('row', { name: /^Tuas/ })).not.toHaveAttribute('data-dim')

    fireEvent.click(screen.getByRole('button', { name: 'Show all sites' }))
    expect(within(grid).getByRole('row', { name: /^Tilbury/ })).not.toHaveAttribute('data-dim')
  })

  it('says how severe a chosen cell is, and opens its assessment', async () => {
    gateway(insights())
    const onOpen = await open()
    const label =
      'Tilbury Distribution Centre · Protection: 7 observations (2 Critical, 3 High, 2 Moderate or Low).'

    const cell = screen.getByRole('button', { name: label })
    expect(cell).toHaveTextContent('7')
    // The most in the grid takes the darkest shade.
    expect(cell).toHaveAttribute('data-step', '7')
    fireEvent.click(cell)

    expect(screen.getByText(label)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open assessment' }))
    expect(onOpen).toHaveBeenCalledWith('RPT-2026-0411', 'Tilbury Distribution Centre')
  })

  it('rings the category a finding points at', async () => {
    gateway(insights())
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Show in the grid' }))

    const protection = screen.getAllByRole('button', { name: /· Protection:/ })
    expect(protection).toHaveLength(2)
    for (const cell of protection) expect(cell).toHaveAttribute('data-ring')
    expect(screen.getByRole('button', { name: /Tilbury.*· Occupancy:/ })).not.toHaveAttribute(
      'data-ring',
    )
  })

  it('brings a finding\u2019s block into view by scrolling the page\u2019s own scroller only', async () => {
    gateway(insights())
    // The app's <main> is the scroller; its frame is clipped and must not move.
    const { container } = render(
      <main className="om-scroll">
        <InsightsTab clientId="c1" onOpen={vi.fn()} />
      </main>,
    )
    await screen.findByRole('heading', { name: 'Sites needing attention' })
    const scroller = container.querySelector('.om-scroll') as HTMLElement
    scroller.scrollTo = vi.fn() as unknown as typeof scroller.scrollTo
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView

    fireEvent.click(screen.getByRole('button', { name: 'Show the change' }))

    expect(scroller.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) }),
    )
    expect(intoView).not.toHaveBeenCalled()
    // The chart turns to the measure the finding is about, with its site lit.
    expect(screen.getByRole('radio', { name: 'Critical and High' })).toBeChecked()
    expect(row('Tilbury Distribution Centre')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows each site\u2019s change for the measure chosen', async () => {
    gateway(insights())
    await open()

    const change = screen.getByRole('table', {
      name: 'Critical and High, first visit against latest',
    })
    const tilbury = within(change).getByRole('row', { name: /^Tilbury/ })
    expect(within(tilbury).getByText('5 → 7')).toBeInTheDocument()
    expect(within(tilbury).getByText('Worse')).toBeInTheDocument()
    expect(within(tilbury).getByText('Mar 2025 to Sep 2026')).toBeVisible()
    expect(
      within(within(change).getByRole('row', { name: /^Tuas/ })).getByText('First visit'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Risk quality score' }))

    const scores = screen.getByRole('table', {
      name: 'Risk quality score, first visit against latest',
    })
    expect(within(scores).getByText('52.9 → 48.6')).toBeInTheDocument()
    expect(within(scores).getByText('Not entered')).toBeInTheDocument()
  })

  it('says so when there is nothing to analyse, or the figures cannot be read', async () => {
    gateway(insights({ empty: true, sites: [], findings: [] }))
    render(<InsightsTab clientId="c1" onOpen={vi.fn()} />)
    expect(await screen.findByText('Nothing to analyse yet')).toBeVisible()
    cleanup()

    gateway(() => json({ error: 'You have no assessments for this client.' }, 403))
    render(<InsightsTab clientId="c1" onOpen={vi.fn()} />)
    expect(await screen.findByText('The insights could not be loaded')).toBeVisible()
    expect(screen.getByText('You have no assessments for this client.')).toBeVisible()
  })
})

describe('The written summary (CP-29)', () => {
  it('is written only when asked, then shown with its sources', async () => {
    const calls = gateway(insights())
    await open()

    expect(screen.getByText(/^No summary yet\./)).toBeVisible()
    expect(calls).toEqual(['GET /api/clients/c1/insights'])
    fireEvent.click(screen.getByRole('button', { name: 'Write summary' }))

    expect(
      await screen.findByText('Fire protection is the main concern across the client.'),
    ).toBeVisible()
    expect(calls).toContain('POST /api/clients/c1/insights/summary')
    expect(
      screen.getByText(
        /^Written by AI .*from 22 observations, 9 accepted OFIs and 1 rating\. It isn't added to any report\.$/,
      ),
    ).toBeVisible()
    expect(screen.getByTitle('Medium confidence')).toBeVisible()
    expect(screen.getByText('Tuas Logistics Hub has no rating yet.')).toBeVisible()
    expect(screen.getByText('In-rack sprinkler valve found closed and untagged.')).toBeVisible()
    // Drawn as the Ask tab's sources are (EvidenceCitation): its kind, then one line of parts,
    // each kept whole so the reference never splits at a hyphen.
    const source = screen
      .getByText('In-rack sprinkler valve found closed and untagged.')
      .closest('li') as HTMLElement
    expect(within(source).getByText('Site observation')).toBeVisible()
    const meta = within(source).getByText('RPT-2026-0411').parentElement!
    expect(meta).toHaveTextContent('Critical · 18 Sep 2026 · RPT-2026-0411')
    expect(meta).toBeVisible()
  })

  it('marks the source a citation number names', async () => {
    gateway(insights({ summary: SUMMARY }))
    await open()

    const source = screen
      .getByText('In-rack sprinkler valve found closed and untagged.')
      .closest('li') as HTMLElement
    expect(source).not.toHaveAttribute('data-on')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Source 2: Tilbury Distribution Centre · High-bay racking, Aisle 14',
      }),
    )

    expect(source).toHaveAttribute('data-on')
  })

  it('says when it is out of date, and writes it again', async () => {
    const calls = gateway(insights({ summary: { ...SUMMARY, outOfDate: true } }))
    await open()

    expect(screen.getByText('Out of date')).toBeVisible()
    fireEvent.click(screen.getAllByRole('button', { name: 'Write again' })[0])

    await waitFor(() => expect(screen.queryByText('Out of date')).not.toBeInTheDocument())
    expect(calls).toContain('POST /api/clients/c1/insights/summary')
  })

  it('says why and when a summary stopped, keeping the one already written', async () => {
    gateway(insights({ summary: SUMMARY }), () =>
      json({ error: "Client details couldn't be protected, so nothing was sent." }, 503),
    )
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Write the summary again' }))

    expect(await screen.findByText(/^Summary stopped at \d\d:\d\d$/)).toBeVisible()
    expect(
      screen.getByText("Client details couldn't be protected, so nothing was sent."),
    ).toBeVisible()
    expect(screen.getByText('Fire protection is the main concern across the client.')).toBeVisible()
  })

  it('offers no summary before there is an observation with words to read', async () => {
    gateway(insights({ canSummarise: false }))
    await open()

    expect(screen.getByText(/A summary can be written once/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Write summary' })).not.toBeInTheDocument()
  })
})
