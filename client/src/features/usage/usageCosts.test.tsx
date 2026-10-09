// Tests for the Usage and costs screen (EV-04). fetch is stubbed; no gateway runs.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { SESSIONS, signIn } from '../../test/session'
import { currentSession } from '../auth/api'

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
  scope: { reportId: null },
  reports: ['RPT-1', 'RPT-2'],
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
    row('label-document'),
  ],
  byService: [row('anthropic', { calls: 5, estimatedCostUsd: 0.01 }), row('openai-whisper')],
  pricingBases: [
    { basis: 'list price 2026-10', calls: 9, isEstimate: false },
    { basis: 'assumed rate', calls: 3, isEstimate: true },
  ],
}
const EMPTY = {
  ...SUMMARY,
  totals: { calls: 0, estimatedCostUsd: 0, callsWithoutCost: 0, estimatedCalls: 0 },
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

function mockGateway(handler: (url: string) => Promise<Response> = () => json(200, SUMMARY)) {
  const fetchMock = vi.fn((url: string) =>
    url.startsWith('/api/usage') ? handler(url) : Promise.reject(new TypeError('Failed to fetch')),
  )
  vi.stubGlobal('fetch', fetchMock)
  return () => fetchMock.mock.calls.map(([u]) => u).filter((u) => u.startsWith('/api/usage'))
}

async function openUsage(role: 'risk_engineer' | 'knowledge_admin' = 'risk_engineer') {
  render(<App />)
  await signIn(role)
  fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
  await screen.findByRole('heading', { name: 'Cost breakdown' })
}

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

describe('Usage and costs (EV-04)', () => {
  it('shows totals and a row per feature with friendly names', async () => {
    mockGateway()
    await openUsage()
    expect(window.location.pathname).toBe('/usage-costs')
    const totals = screen.getByText('Total estimated cost').parentElement!
    expect(totals).toHaveTextContent('$0.0123')
    const table = screen.getByRole('table', { name: 'Cost by feature' })
    for (const name of [
      'Drafting',
      'Retrieval (search)',
      'Voice transcription',
      'Document labelling',
    ])
      expect(within(table).getByRole('rowheader', { name })).toBeInTheDocument()
  })

  it('shows usage with dashes for units that do not apply, and speed in ms or s', async () => {
    mockGateway()
    await openUsage()
    const usage = screen.getByRole('table', { name: 'Usage by feature' })
    const drafting = within(usage).getByRole('row', { name: /Drafting/ })
    expect(drafting).toHaveTextContent('12,000')
    expect(within(usage).getByRole('row', { name: /Voice transcription/ })).toHaveTextContent('1.5')
    const speed = screen.getByRole('table', { name: 'Speed by feature' })
    const fast = within(speed).getByRole('row', { name: /Drafting/ })
    expect(fast).toHaveTextContent('1.5 s')
    expect(fast).toHaveTextContent('850 ms')
  })

  it('switches to the billed-service view', async () => {
    mockGateway()
    await openUsage()
    fireEvent.click(screen.getByRole('tab', { name: 'By billed service' }))
    const table = screen.getByRole('table', { name: 'Cost by billed service' })
    expect(within(table).getByRole('rowheader', { name: 'Anthropic (Claude)' })).toBeInTheDocument()
  })

  it('refetches for the chosen report', async () => {
    const urls = mockGateway()
    await openUsage()
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'RPT-2' } })
    await waitFor(() => expect(urls()).toContain('/api/usage/summary?reportId=RPT-2'))
  })

  it('labels the all-reports choice by role', async () => {
    mockGateway()
    await openUsage()
    expect(screen.getByRole('option', { name: 'All my reports' })).toBeInTheDocument()
    cleanup()
    await openUsage('knowledge_admin')
    expect(screen.getByRole('option', { name: 'All reports' })).toBeInTheDocument()
  })

  it('explains estimates, calls without cost and pricing bases', async () => {
    mockGateway()
    await openUsage()
    expect(screen.getByText(/3 of 12 calls use an estimated price/)).toBeInTheDocument()
    expect(screen.getByText(/2 calls have no cost and are not included/)).toBeInTheDocument()
    const bases = screen.getByRole('list', { name: 'Pricing bases' })
    expect(within(bases).getByText('estimate')).toBeInTheDocument()
    expect(within(bases).getByText(/list price 2026-10/)).toBeInTheDocument()
  })

  it('points the export link at the current report and view', async () => {
    // Like the real gateway, the answer says which report it is for.
    mockGateway((url) =>
      json(200, {
        ...SUMMARY,
        scope: { reportId: new URL(url, 'http://x').searchParams.get('reportId') },
      }),
    )
    await openUsage()
    const link = screen.getByRole('link', { name: 'Export CSV' })
    expect(link).toHaveAttribute('href', '/api/usage/export.csv?groupBy=feature')
    fireEvent.click(screen.getByRole('tab', { name: 'By billed service' }))
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'RPT-1' } })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
        'href',
        '/api/usage/export.csv?groupBy=service&reportId=RPT-1',
      ),
    )
  })

  it('keeps the export link on the report shown while another one loads', async () => {
    // The second report never answers, so the old numbers stay on screen.
    mockGateway((url) =>
      url.includes('RPT-2') ? new Promise<Response>(() => {}) : json(200, SUMMARY),
    )
    await openUsage()
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'RPT-2' } })
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/export.csv?groupBy=feature',
    )
  })

  it('shows an empty state instead of zero tables', async () => {
    mockGateway(() => json(200, EMPTY))
    render(<App />)
    await signIn()
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
    expect(await screen.findByText('No AI calls recorded yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a message when the report is not allowed (403)', async () => {
    mockGateway((url) =>
      url.includes('reportId') ? json(403, { error: 'Forbidden' }) : json(200, SUMMARY),
    )
    await openUsage()
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'RPT-2' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have access/)
  })

  it('shows an error with a retry when the gateway fails', async () => {
    mockGateway(() => json(500, { error: 'boom' }))
    render(<App />)
    await signIn()
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('opens from the URL for both roles', async () => {
    mockGateway()
    for (const role of ['risk_engineer', 'knowledge_admin'] as const) {
      window.history.replaceState(null, '', '/usage-costs')
      render(<App />)
      await signIn(role)
      expect(await screen.findByRole('heading', { name: 'Cost breakdown' })).toBeInTheDocument()
      cleanup()
    }
  })

  it('blocks a user without the permission', async () => {
    mockGateway()
    const session = SESSIONS.risk_engineer
    vi.mocked(currentSession).mockResolvedValueOnce({
      ...session,
      permissions: session.permissions.filter((p) => p !== 'usage:view'),
    })
    window.history.replaceState(null, '', '/usage-costs')
    render(<App />)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Cost breakdown' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Usage and costs' })).toBeNull()
  })
})
