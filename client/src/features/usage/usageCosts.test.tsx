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
  segments: { anthropic: 0.5 },
  ...over,
})

const OVERVIEW = {
  scope: { groupBy: 'assessment', split: 'service', range: '30d', from: null },
  totals: { calls: 12, estimatedCostUsd: 2.5, callsWithoutCost: 2, estimatedCalls: 3 },
  splitKeys: ['anthropic', 'gemini-vision'],
  groups: [
    group('RPT-1', {
      estimatedCostUsd: 2,
      segments: { anthropic: 1.8, 'gemini-vision': 0.2 },
    }),
    group('RPT-2', {
      client: 'Borealis',
      siteName: 'Tuas warehouse',
      engineerId: JIDE,
      engineerName: 'Jide Okafor',
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

// One quantity at the rate it was charged, per 1M tokens unless overridden.
const cell = (
  quantity: number,
  usdPer: number | null,
  costUsd: number | null,
  note: string | null = null,
) => ({
  quantity,
  unit: 'tokens',
  usdPer,
  per: 1_000_000,
  costUsd,
  note,
})
// One row of the drill-in's usage and rates: a feature's calls to one model.
const rateRow = (over: Record<string, unknown> = {}) => ({
  feature: 'draft-section',
  service: 'anthropic',
  model: 'claude-sonnet-5-5',
  calls: 5,
  rates: 'charged',
  note: null,
  cells: {},
  costUsd: 0,
  avgMsPerCall: 850,
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
  rateRows: [
    // Sonnet: 1,000,000 in × $2/1M = $2.00; 100,000 out × $10/1M = $1.00.
    rateRow({
      cells: { input: cell(1_000_000, 2, 2), output: cell(100_000, 10, 1) },
      costUsd: 3,
    }),
    rateRow({
      feature: 'retrieval',
      service: 'cohere-rerank',
      model: 'rerank-v3.5',
      calls: 4,
      cells: {
        searches: { ...cell(8, 0, 0, 'Trial key: free'), unit: 'searches', per: 1000 },
      },
      costUsd: 0,
    }),
    rateRow({
      feature: 'transcribe',
      service: 'openai-whisper',
      model: 'whisper-1',
      calls: 3,
      cells: { audio: { ...cell(1.5, 0.006, 0.009), unit: 'minutes', per: 1 } },
      costUsd: 0.009,
    }),
    rateRow({
      model: 'claude-unknown-9',
      rates: 'not priced',
      note: 'no price for model',
      cells: { input: cell(12_000, null, null) },
      costUsd: null,
    }),
  ],
}

// The chatbot's page: two days of a week, two people who asked, and the
// answers' usage at the rates charged (gpt-6.1-sol, $0.007 an answer).
const chatDay = (key: string, calls: number) => ({
  key,
  calls,
  estimatedCostUsd: calls * 0.007,
  callsWithoutCost: 0,
  lastActivityAt: calls ? `${key}T04:00:00.000Z` : null,
  segments: calls ? { openai: calls * 0.007 } : {},
})
const CHAT = {
  scope: { range: '30d', from: '2026-09-13T10:00:00.000Z' },
  totals: { calls: 3, estimatedCostUsd: 0.021, callsWithoutCost: 0, estimatedCalls: 0 },
  splitKeys: ['openai'],
  byDay: [chatDay('2026-10-11', 1), chatDay('2026-10-12', 0), chatDay('2026-10-13', 2)],
  byUser: [
    { ...chatDay(ALEX, 2), name: 'Alex Tan' },
    { ...chatDay(JIDE, 1), name: 'Jide Okafor' },
  ],
  rateRows: [
    rateRow({
      feature: 'chat',
      service: 'openai',
      model: 'gpt-6.1-sol',
      calls: 3,
      cells: { input: cell(3000, 2, 0.006), output: cell(1500, 10, 0.015) },
      costUsd: 0.021,
    }),
  ],
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

// Answers the overview by grouping and the summary for a report, like the gateway.
function defaultAnswer(url: string) {
  if (url.startsWith('/api/usage/summary')) return json(200, SUMMARY)
  if (url.startsWith('/api/usage/chat')) return json(200, CHAT)
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

  it('shows calls without a cost and estimated prices in the totals, with no notice box', async () => {
    mockGateway()
    await openUsage()
    const totals = screen.getByText('Total estimated cost').closest('section') as HTMLElement
    expect(within(totals).getByText('Estimated')).toBeInTheDocument()
    expect(within(totals).getByText('Calls without cost').parentElement).toHaveTextContent('2')
    expect(screen.queryByText('How these costs are worked out')).toBeNull()
  })

  it('keeps the table to its totals: no tokens, nothing to expand', async () => {
    mockGateway()
    await openUsage()
    const headers = within(assessmentTable())
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).not.toContain('Tokens')
    expect(screen.queryByRole('button', { name: /^Show cost calculation/ })).toBeNull()
  })

  it('opens the chatbot from its row: cost per day and per person, and usage at the rates charged', async () => {
    const urls = mockGateway()
    await openUsage()
    const chat = within(assessmentTable()).getByRole('row', { name: /Chatbot/ })
    fireEvent.click(within(chat).getByRole('button', { name: 'Chatbot' }))

    expect(await screen.findByRole('heading', { name: 'Chatbot' })).toBeInTheDocument()
    expect(urls()).toContain('/api/usage/chat?range=30d')
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
    expect(screen.getByText('Total estimated cost').parentElement).toHaveTextContent('$0.0210')
    expect(
      screen.getByRole('table', { name: 'Cost per day, split by service' }),
    ).toBeInTheDocument()

    const days = screen.getByRole('table', { name: 'Chat cost per day' })
    expect(
      within(days)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringMatching(/^11 Oct 2026.*\$0\.0070$/),
      expect.stringMatching(/^12 Oct 2026/),
      expect.stringMatching(/^13 Oct 2026.*\$0\.0140$/),
    ])
    const people = screen.getByRole('table', { name: 'Chat cost per person' })
    expect(within(people).getByRole('row', { name: /Alex Tan/ })).toHaveTextContent('$0.0140')

    const rates = screen.getByRole('table', { name: 'Claude and OpenAI: usage and rates' })
    expect(within(rates).getByRole('row', { name: /gpt-6\.1-sol/ })).toHaveTextContent(
      '@ $2.00 / 1M tokens',
    )
    expect(screen.getByRole('link', { name: 'Export rates CSV' })).toHaveAttribute(
      'href',
      '/api/usage/chat/export.csv?range=30d',
    )
  })

  it('opens the chatbot for the period chosen, and goes back', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7d' } })
    await waitFor(() => expect(lastQuery(urls()).get('range')).toBe('7d'))
    const chat = within(assessmentTable()).getByRole('row', { name: /Chatbot/ })
    fireEvent.click(within(chat).getByRole('button', { name: 'Chatbot' }))

    await screen.findByRole('heading', { name: 'Chatbot' })
    expect(urls()).toContain('/api/usage/chat?range=7d')
    fireEvent.click(screen.getByRole('button', { name: 'All assessments' }))
    expect(
      await screen.findByRole('table', { name: 'Assessments and their cost' }),
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

  it('shows cost and speed per feature with friendly names', async () => {
    await openRpt1()
    const cost = screen.getByRole('table', { name: 'Cost by feature' })
    for (const name of ['Drafting', 'Retrieval (search)', 'Voice transcription'])
      expect(within(cost).getByRole('rowheader', { name })).toBeInTheDocument()
    const speed = screen.getByRole('table', { name: 'Speed by feature' })
    expect(within(speed).getByRole('row', { name: /Drafting/ })).toHaveTextContent('850 ms')
  })

  it('shows usage at the rates charged, one table per way of billing', async () => {
    await openRpt1()
    expect(screen.queryByRole('table', { name: 'Usage by feature' })).toBeNull()

    const claude = screen.getByRole('table', { name: 'Claude and OpenAI: usage and rates' })
    const headers = within(claude)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual([
      'Feature',
      'Model',
      'Calls',
      'Input tokens',
      'Output tokens',
      'Cached input tokens',
      'Cost',
    ])
    const sonnet = within(claude).getByRole('row', { name: /claude-sonnet-5-5/ })
    for (const text of ['Drafting', '1,000,000', '@ $2.00 / 1M tokens', '100,000', '$3.00'])
      expect(sonnet).toHaveTextContent(text)
    const unpriced = within(claude).getByRole('row', { name: /claude-unknown-9/ })
    expect(unpriced).toHaveTextContent('12,000')
    expect(unpriced).toHaveTextContent('no price for model')
    expect(unpriced).not.toHaveTextContent('@')
    expect(within(claude).getByRole('row', { name: /Subtotal/ })).toHaveTextContent('$3.00')

    const rerank = screen.getByRole('table', { name: 'Cohere rerank: usage and rates' })
    expect(
      within(rerank)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toContain('Searches')
    expect(rerank).toHaveTextContent('Trial key: free')
    const whisper = screen.getByRole('table', { name: 'OpenAI Whisper: usage and rates' })
    expect(within(whisper).getByRole('row', { name: /Voice transcription/ })).toHaveTextContent(
      '1.5',
    )
    expect(whisper).toHaveTextContent('@ $0.006 / min')
  })

  it('exports the usage and rates', async () => {
    await openRpt1()
    expect(screen.getByRole('link', { name: 'Export rates CSV' })).toHaveAttribute(
      'href',
      '/api/usage/export.csv?groupBy=rates&reportId=RPT-1',
    )
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
