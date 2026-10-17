// Tests for the Usage and costs screen (EV-04): the report-generation overview
// and one assessment's drill-in. fetch is stubbed; no gateway runs.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

const ALEX = '64b000000000000000000a1e'
const JIDE = '64b000000000000000000a1d'

const group = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  reference: key,
  client: 'Acme',
  siteName: 'Jurong plant',
  engineerId: ALEX,
  engineerName: 'Alex Tan',
  lastActivityAt: '2026-10-05T00:00:00.000Z',
  calls: 3,
  estimatedCostUsd: 0.5,
  callsWithoutCost: 0,
  totalTokens: 0,
  costLines: [],
  reconciliation: { calculatedUsd: 0.5, recordedUsd: 0.5, differenceUsd: 0 },
  segments: { anthropic: 0.5 },
  ...over,
})

// One line of a row's cost calculation, as the gateway sends it.
const line = (over: Record<string, unknown> = {}) => ({
  service: 'anthropic',
  model: 'claude-sonnet-5-5',
  part: 'input',
  unit: 'tokens',
  quantity: 1_000_000,
  usdPer: 2,
  per: 1_000_000,
  costUsd: 2,
  note: null,
  ...over,
})

const OVERVIEW = {
  scope: { groupBy: 'assessment', split: 'service', range: '30d', from: null },
  totals: { calls: 12, estimatedCostUsd: 2.5, callsWithoutCost: 2, estimatedCalls: 3 },
  splitKeys: ['anthropic', 'gemini-vision'],
  groups: [
    group('RPT-1', {
      estimatedCostUsd: 2,
      totalTokens: 1_600_000,
      segments: { anthropic: 1.8, 'gemini-vision': 0.2 },
      costLines: [
        line({ quantity: 1_025_000, costUsd: 2.05 }),
        line({
          service: 'cohere-rerank',
          model: 'rerank-v3.5',
          part: 'searches',
          unit: 'searches',
          quantity: 140,
          usdPer: 0,
          per: 1000,
          costUsd: 0,
          note: 'Trial key: free',
        }),
        line({
          model: 'claude-unknown-9',
          part: 'not priced',
          quantity: 12_000,
          usdPer: 0,
          costUsd: 0,
          note: 'no price for model',
        }),
      ],
      // Recorded at an older price.
      reconciliation: { calculatedUsd: 2.05, recordedUsd: 2, differenceUsd: 0.05 },
    }),
    group('RPT-2', {
      client: 'Borealis',
      siteName: 'Tuas warehouse',
      engineerId: JIDE,
      engineerName: 'Jide Okafor',
      // Sonnet: 200,000 in × $2/1M = $0.40; 10,000 out × $10/1M = $0.10.
      totalTokens: 210_000,
      costLines: [
        line({ quantity: 200_000, costUsd: 0.4 }),
        line({ part: 'output', quantity: 10_000, usdPer: 10, costUsd: 0.1 }),
      ],
    }),
    group('chat', {
      label: 'Chatbot',
      reference: null,
      client: null,
      siteName: null,
      engineerId: null,
      engineerName: null,
      estimatedCostUsd: 0,
      segments: {},
      costLines: [line({ service: 'openai', model: 'gpt-6.1-sol', quantity: 0, costUsd: 0 })],
    }),
  ],
  pricingBases: [
    { basis: 'list price 2026-10', calls: 9, isEstimate: false },
    { basis: 'assumed rate', calls: 3, isEstimate: true },
  ],
}

const BY_ENGINEER = {
  ...OVERVIEW,
  scope: { ...OVERVIEW.scope, groupBy: 'engineer' },
  groups: [
    group(ALEX, { label: 'Alex Tan', reference: null, client: null, siteName: null }),
    group(JIDE, {
      label: 'Jide Okafor',
      reference: null,
      client: null,
      siteName: null,
      engineerId: JIDE,
      engineerName: 'Jide Okafor',
    }),
  ],
}

const row = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  calls: 0,
  estimatedCostUsd: 0,
  callsWithoutCost: 0,
  estimatedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  searchUnits: 0,
  audioSeconds: 0,
  latency: { avgMs: null, p50Ms: null, p95Ms: null, maxMs: null },
  ...over,
})

const SUMMARY = {
  scope: { reportId: 'RPT-1' },
  reports: ['RPT-1'],
  totals: { calls: 12, estimatedCostUsd: 0.0123, callsWithoutCost: 2, estimatedCalls: 3 },
  byFeature: [
    row('draft-section', {
      calls: 5,
      estimatedCostUsd: 0.01,
      inputTokens: 12000,
      outputTokens: 800,
      latency: { avgMs: 1500, p50Ms: 850, p95Ms: 2400, maxMs: 3000 },
    }),
    row('retrieval', { calls: 4, searchUnits: 8 }),
    row('transcribe', { calls: 3, audioSeconds: 90, callsWithoutCost: 2 }),
  ],
  byService: [row('anthropic', { calls: 5, estimatedCostUsd: 0.01 }), row('openai-whisper')],
  byFeatureService: [
    { feature: 'draft-section', calls: 5, estimatedCostUsd: 0.01, segments: { anthropic: 0.01 } },
  ],
  bySection: [
    {
      section: '7',
      title: 'Construction',
      calls: 4,
      drafts: 2,
      estimatedCostUsd: 0.008,
      callsWithoutCost: 0,
    },
    {
      section: null,
      title: 'Unspecified',
      calls: 1,
      drafts: 1,
      estimatedCostUsd: 0.002,
      callsWithoutCost: 0,
    },
  ],
  pricingBases: OVERVIEW.pricingBases,
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

// Answers the overview by grouping and the summary for a report, like the gateway.
function defaultAnswer(url: string) {
  if (url.startsWith('/api/usage/summary')) return json(200, SUMMARY)
  const query = new URL(url, 'http://x').searchParams
  return json(200, query.get('groupBy') === 'engineer' ? BY_ENGINEER : OVERVIEW)
}

function mockGateway(handler: (url: string) => Promise<Response> = defaultAnswer) {
  const fetchMock = vi.fn((url: string) =>
    url.startsWith('/api/usage') ? handler(url) : Promise.reject(new TypeError('Failed to fetch')),
  )
  vi.stubGlobal('fetch', fetchMock)
  return () => fetchMock.mock.calls.map(([u]) => u).filter((u) => u.startsWith('/api/usage'))
}
const lastQuery = (urls: string[]) =>
  new URL(urls.filter((u) => u.startsWith('/api/usage/overview')).at(-1)!, 'http://x').searchParams

async function openUsage(role: 'risk_engineer' | 'knowledge_admin' = 'knowledge_admin') {
  render(<App />)
  await signIn(role)
  fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
  // The screen is loaded on first open, which takes longer while other suites run.
  await screen.findByRole('table', { name: 'Assessments and their cost' }, { timeout: 15000 })
}
const assessmentTable = () => screen.getByRole('table', { name: 'Assessments and their cost' })

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() =>
  // Recharts measures its container; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The screen and its chart library load on first open, which is slow while
// every suite runs at once; as for the chat screen, allow for it.
const LAZY_SCREEN = { timeout: 30000 }

describe('Usage and costs: report generation overview (EV-04)', LAZY_SCREEN, () => {
  it('opens on every assessment for the last 30 days, split by billed service', async () => {
    const urls = mockGateway()
    await openUsage()
    expect(window.location.pathname).toBe('/usage-costs')
    expect(Object.fromEntries(lastQuery(urls()))).toEqual({
      groupBy: 'assessment',
      split: 'service',
      range: '30d',
    })
    const totals = screen.getByText('Total estimated cost').parentElement!
    expect(totals).toHaveTextContent('$2.50')
    const first = within(assessmentTable()).getByRole('row', { name: /RPT-1/ })
    for (const text of ['Acme', 'Jurong plant', 'Alex Tan', '5 Oct 2026', '$2.00'])
      expect(first).toHaveTextContent(text)
    // The chart gives the same bars to screen readers.
    expect(screen.getByRole('table', { name: 'Cost by assessment' })).toBeInTheDocument()
  })

  it('shows each assessment’s tokens beside its total cost', async () => {
    mockGateway()
    await openUsage()
    const headers = within(assessmentTable())
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers.slice(-2)).toEqual(['Tokens', 'Total cost'])
    const first = within(assessmentTable()).getByRole('row', { name: /RPT-1/ })
    const tokens = within(first).getByTitle('1,600,000 tokens')
    expect(tokens).toHaveTextContent('1.6M')
  })

  it('opens an assessment’s cost calculation from its chevron: quantity × rate = cost', async () => {
    mockGateway()
    await openUsage()
    const toggle = screen.getByRole('button', { name: 'Show cost calculation for RPT-2' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table', { name: 'Cost calculation for RPT-2' })).toBeNull()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const calc = screen.getByRole('table', { name: 'Cost calculation for RPT-2' })
    const input = within(calc).getByRole('row', { name: /claude-sonnet-5-5 — input/ })
    for (const text of ['Anthropic (Claude)', '200,000 tokens', '$2.00 / 1M tokens', '$0.4000'])
      expect(input).toHaveTextContent(text)
    const output = within(calc).getByRole('row', { name: /claude-sonnet-5-5 — output/ })
    for (const text of ['10,000 tokens', '$10.00 / 1M tokens', '$0.1000'])
      expect(output).toHaveTextContent(text)
    expect(within(calc).getByRole('row', { name: /Calculated/ })).toHaveTextContent('$0.5000')
    expect(within(calc).getByRole('row', { name: /Recorded/ })).toHaveTextContent('$0.5000')
    expect(within(calc).getByRole('row', { name: /Difference/ })).toHaveTextContent('$0.00')
  })

  it('keeps several calculations open at once, and closes them for a new period', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.click(screen.getByRole('button', { name: 'Show cost calculation for RPT-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show cost calculation for RPT-2' }))
    expect(screen.getByRole('table', { name: 'Cost calculation for RPT-1' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Cost calculation for RPT-2' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7d' } })
    await waitFor(() => expect(lastQuery(urls()).get('range')).toBe('7d'))

    await waitFor(() =>
      expect(screen.queryAllByRole('table', { name: /^Cost calculation for/ })).toHaveLength(0),
    )
  })

  it('reloads for the period and split chosen', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7d' } })
    await waitFor(() => expect(lastQuery(urls()).get('range')).toBe('7d'))
    fireEvent.change(screen.getByLabelText('Split each bar by'), { target: { value: 'feature' } })
    await waitFor(() => expect(lastQuery(urls()).get('split')).toBe('feature'))
  })

  it('lets a knowledge admin compare engineers, then open one engineer’s assessments', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'engineer' } })
    const engineers = await screen.findByRole('table', { name: 'Engineers and their cost' })
    fireEvent.click(within(engineers).getByRole('button', { name: 'Jide Okafor' }))
    await waitFor(() => {
      const query = lastQuery(urls())
      expect(query.get('groupBy')).toBe('assessment')
      expect(query.get('engineer')).toBe(JIDE)
    })
    expect(await screen.findByText('Assessments of Jide Okafor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show every engineer' }))
    await waitFor(() => expect(lastQuery(urls()).has('engineer')).toBe(false))
  })

  it('narrows to an engineer chosen in the table filter', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Engineer'), { target: { value: JIDE } })
    await waitFor(() => expect(lastQuery(urls()).get('engineer')).toBe(JIDE))
  })

  it('finds an assessment by its reference, client or site', async () => {
    mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Find an assessment'), { target: { value: 'tuas' } })
    const rows = within(assessmentTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('RPT-2')
  })

  it('exports what is on screen', async () => {
    mockGateway()
    await openUsage()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/overview/export.csv?groupBy=assessment&split=service&range=30d',
    )
    fireEvent.change(screen.getByLabelText('Engineer'), { target: { value: JIDE } })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
        'href',
        `/api/usage/overview/export.csv?groupBy=assessment&split=service&range=30d&engineer=${JIDE}`,
      ),
    )
  })

  it('explains estimates, calls without cost and pricing bases', async () => {
    mockGateway()
    await openUsage()
    expect(screen.getByText(/3 of 12 calls use an estimated price/)).toBeInTheDocument()
    expect(screen.getByText(/2 calls have no cost and are not included/)).toBeInTheDocument()
    const bases = screen.getByRole('list', { name: 'Pricing bases' })
    expect(within(bases).getByText('estimate')).toBeInTheDocument()
    // Why Tokens can look short beside the cost.
    expect(
      screen.getByText(/Whisper is billed by audio time and Cohere rerank by searches/),
    ).toBeInTheDocument()
  })

  it('shows chat as a row with no assessment to open, but its cost calculation', async () => {
    mockGateway()
    await openUsage()
    const chat = within(assessmentTable()).getByRole('row', { name: /Chatbot/ })
    expect(within(chat).queryByRole('button', { name: 'Chatbot' })).toBeNull()
    expect(
      within(chat).getByRole('button', { name: 'Show cost calculation for Chatbot' }),
    ).toBeInTheDocument()
  })

  it('explains a free rate, a call with no price, and a price changed since recording', async () => {
    mockGateway()
    await openUsage()
    fireEvent.click(screen.getByRole('button', { name: 'Show cost calculation for RPT-1' }))
    const calc = screen.getByRole('table', { name: 'Cost calculation for RPT-1' })

    const rerank = within(calc).getByRole('row', { name: /rerank-v3\.5 — searches/ })
    for (const text of ['140 searches', '$0.00 / 1K searches', 'Trial key: free'])
      expect(rerank).toHaveTextContent(text)
    const unpriced = within(calc).getByRole('row', { name: /claude-unknown-9 — not priced/ })
    expect(unpriced).toHaveTextContent('12,000 tokens')
    expect(unpriced).toHaveTextContent('no price for model')
    expect(unpriced).not.toHaveTextContent('$0.00 / 1M tokens')

    const difference = within(calc).getByRole('row', { name: /Difference/ })
    expect(difference).toHaveTextContent('$0.0500')
    expect(difference).toHaveTextContent('Prices changed since recording')
  })

  it('says when a row has nothing to calculate', async () => {
    mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'engineer' } })
    const engineers = await screen.findByRole('table', { name: 'Engineers and their cost' })
    fireEvent.click(
      within(engineers).getByRole('button', { name: 'Show cost calculation for Alex Tan' }),
    )
    expect(screen.getByText('No priced calls in this period.')).toBeInTheDocument()
  })

  it('names the chat’s OpenAI calls in its cost calculation', async () => {
    mockGateway()
    await openUsage()
    fireEvent.click(screen.getByRole('button', { name: 'Show cost calculation for Chatbot' }))
    const calc = screen.getByRole('table', { name: 'Cost calculation for Chatbot' })
    expect(
      within(calc).getByRole('row', { name: /^OpenAI chat · gpt-6\.1-sol — input/ }),
    ).toBeInTheDocument()
  })

  it('shows a risk engineer their own assessments, with no engineer controls', async () => {
    mockGateway()
    await openUsage('risk_engineer')
    expect(screen.queryByLabelText('Group by')).toBeNull()
    expect(screen.queryByLabelText('Engineer')).toBeNull()
    expect(within(assessmentTable()).queryByRole('columnheader', { name: 'Engineer' })).toBeNull()
  })

  it('shows an empty state instead of an empty chart and table', async () => {
    mockGateway((url) =>
      url.startsWith('/api/usage/overview')
        ? json(200, {
            ...OVERVIEW,
            groups: [],
            totals: { calls: 0, estimatedCostUsd: 0, callsWithoutCost: 0, estimatedCalls: 0 },
            pricingBases: [],
          })
        : defaultAnswer(url),
    )
    render(<App />)
    await signIn('knowledge_admin')
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
    expect(
      await screen.findByText('No AI calls in this period', {}, { timeout: 15000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows an error with a retry when the gateway fails', async () => {
    let fail = true
    mockGateway((url) => (fail ? json(500, { error: 'boom' }) : defaultAnswer(url)))
    render(<App />)
    await signIn('knowledge_admin')
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
    expect(await screen.findByRole('alert', {}, { timeout: 15000 })).toHaveTextContent(
      /could not be loaded/,
    )
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('table', { name: 'Assessments and their cost' }),
    ).toBeInTheDocument()
  })
})

describe('Usage and costs: one assessment (EV-04 AC2)', LAZY_SCREEN, () => {
  async function openRpt1(urls = mockGateway()) {
    await openUsage()
    fireEvent.click(within(assessmentTable()).getByRole('button', { name: 'RPT-1' }))
    await screen.findByRole('heading', { name: 'RPT-1' })
    return urls
  }

  it('opens from the table with its totals and what each section cost to draft', async () => {
    const urls = await openRpt1()
    expect(urls()).toContain('/api/usage/summary?reportId=RPT-1')
    const sections = screen.getByRole('table', { name: 'Drafting cost by report section' })
    const construction = within(sections).getByRole('row', { name: /Construction/ })
    expect(construction).toHaveTextContent('7')
    expect(construction).toHaveTextContent('2')
    expect(construction).toHaveTextContent('$0.0080')
    expect(within(sections).getByRole('row', { name: /Unspecified/ })).toBeInTheDocument()
    expect(
      screen.getByRole('table', { name: 'Cost by feature, split by service' }),
    ).toBeInTheDocument()
  })

  it('shows cost, usage and speed per feature with friendly names', async () => {
    await openRpt1()
    const cost = screen.getByRole('table', { name: 'Cost by feature' })
    for (const name of ['Drafting', 'Retrieval (search)', 'Voice transcription'])
      expect(within(cost).getByRole('rowheader', { name })).toBeInTheDocument()
    const usage = screen.getByRole('table', { name: 'Usage by feature' })
    expect(within(usage).getByRole('row', { name: /Drafting/ })).toHaveTextContent('12,000')
    const speed = screen.getByRole('table', { name: 'Speed by feature' })
    expect(within(speed).getByRole('row', { name: /Drafting/ })).toHaveTextContent('850 ms')
  })

  it('switches the breakdown to billed services, and exports the one shown', async () => {
    await openRpt1()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/export.csv?groupBy=feature&reportId=RPT-1',
    )
    fireEvent.click(screen.getByRole('tab', { name: 'By billed service' }))
    expect(screen.getByRole('table', { name: 'Cost by billed service' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/export.csv?groupBy=service&reportId=RPT-1',
    )
  })

  it('goes back to every assessment', async () => {
    await openRpt1()
    fireEvent.click(screen.getByRole('button', { name: 'All assessments' }))
    expect(
      await screen.findByRole('table', { name: 'Assessments and their cost' }),
    ).toBeInTheDocument()
  })

  it('says so when the assessment is not the engineer’s (403)', async () => {
    mockGateway((url) =>
      url.startsWith('/api/usage/summary') ? json(403, { error: 'Forbidden' }) : defaultAnswer(url),
    )
    await openUsage()
    fireEvent.click(within(assessmentTable()).getByRole('button', { name: 'RPT-1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have access/)
  })
})
