// Tests for the Ingestion tab of Usage and costs (EV-04): what reading each
// knowledge document cost. Knowledge admins only. fetch is stubbed.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

const doc = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  label: key,
  title: 'NFPA 13: Standard for the Installation of Sprinkler Systems',
  fileName: 'nfpa13.pdf',
  status: 'complete',
  saved: true,
  uploadedAt: '2026-10-01T00:00:00.000Z',
  pages: 40,
  calls: 32,
  estimatedCostUsd: 0.8,
  callsWithoutCost: 0,
  usdPerPage: 0.02,
  avgMsPerCall: 2200,
  lastActivityAt: '2026-10-01T00:00:00.000Z',
  segments: { 'gemini-ocr': 0.6, anthropic: 0.2 },
  ...over,
})

const INGESTION = {
  scope: { split: 'service', range: '30d', from: null },
  totals: { calls: 40, estimatedCostUsd: 1.1, callsWithoutCost: 0, estimatedCalls: 0 },
  splitKeys: ['gemini-ocr', 'anthropic'],
  documents: [
    doc('d1'),
    doc('d2', {
      title: 'Old scanned code',
      fileName: 'scan.pdf',
      status: 'failed',
      pages: null,
      usdPerPage: null,
      estimatedCostUsd: 0.3,
      segments: { 'gemini-ocr': 0.3 },
    }),
    doc('d3', {
      title: 'Upload not saved',
      fileName: null,
      status: null,
      saved: false,
      uploadedAt: null,
      pages: null,
      usdPerPage: null,
      estimatedCostUsd: 0.001,
      segments: { anthropic: 0.001 },
    }),
  ],
  pricingBases: [{ basis: 'Google list price', calls: 30, isEstimate: false }],
}
const OVERVIEW = {
  scope: { groupBy: 'assessment', split: 'service', range: '30d', from: null },
  totals: { calls: 0, estimatedCostUsd: 0, callsWithoutCost: 0, estimatedCalls: 0 },
  splitKeys: [],
  groups: [],
  pricingBases: [],
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

// One document's detail page: Gemini OCR (four calls summed, 4 s in all) and
// labelling, each quantity at the rate it was charged.
const per1M = (quantity: number, usdPer: number, costUsd: number) => ({
  quantity,
  unit: 'tokens',
  usdPer,
  per: 1_000_000,
  costUsd,
  note: null,
})
const DETAIL = {
  key: 'd1',
  title: 'NFPA 13: Standard for the Installation of Sprinkler Systems',
  fileName: 'nfpa13.pdf',
  status: 'complete',
  saved: true,
  uploadedAt: '2026-10-01T00:00:00.000Z',
  pages: 40,
  totals: { calls: 5, estimatedCostUsd: 0.65, callsWithoutCost: 0, estimatedCalls: 0 },
  byFeatureService: [
    { feature: 'ocr', calls: 4, estimatedCostUsd: 0.45, segments: { 'gemini-ocr': 0.45 } },
    {
      feature: 'label-document',
      calls: 1,
      estimatedCostUsd: 0.2,
      segments: { 'openai-label': 0.2 },
    },
  ],
  rateRows: [
    {
      feature: 'ocr',
      service: 'gemini-ocr',
      model: 'gemini-3.8-flash',
      calls: 4,
      rates: 'charged',
      note: null,
      // 400,000 in × $0.75/1M = $0.30; 40,000 out × $3.75/1M = $0.15.
      cells: { input: per1M(400_000, 0.75, 0.3), output: per1M(40_000, 3.75, 0.15) },
      costUsd: 0.45,
      avgMsPerCall: 1000,
    },
    {
      feature: 'label-document',
      service: 'openai-label',
      model: 'gpt-6-luna',
      calls: 1,
      rates: 'charged',
      note: null,
      cells: { input: per1M(1_000_000, 0.1, 0.1), output: per1M(200_000, 0.5, 0.1) },
      costUsd: 0.2,
      avgMsPerCall: 2000,
    },
  ],
}

function mockGateway(ingestion: unknown = INGESTION, detail = () => json(200, DETAIL)) {
  const fetchMock = vi.fn((url: string) => {
    if (/^\/api\/usage\/ingestion\/(?!export)/.test(url)) return detail()
    if (url.startsWith('/api/usage/ingestion')) return json(200, ingestion)
    if (url.startsWith('/api/usage/overview')) return json(200, OVERVIEW)
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  vi.stubGlobal('fetch', fetchMock)
  return () =>
    fetchMock.mock.calls.map(([u]) => u).filter((u) => u.startsWith('/api/usage/ingestion'))
}

async function openIngestion() {
  render(<App />)
  await signIn('knowledge_admin')
  fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
  fireEvent.click(await screen.findByRole('tab', { name: 'Ingestion' }, { timeout: 15000 }))
}
const documentsTable = () => screen.getByRole('table', { name: 'Documents and their cost' })

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

// The screen and its chart library load on first open; allow for a busy run.
describe('Usage and costs: ingestion (EV-04)', { timeout: 30000 }, () => {
  it('shows each document’s cost for the last 30 days, split by billed service', async () => {
    const urls = mockGateway()
    await openIngestion()
    const table = await screen.findByRole('table', { name: 'Documents and their cost' })
    expect(urls().at(-1)).toBe('/api/usage/ingestion?split=service&range=30d')
    const nfpa = within(table).getByRole('row', { name: /NFPA 13/ })
    for (const text of ['Complete', '1 Oct 2026', '40', '32', '$0.8000', '$0.0200'])
      expect(nfpa).toHaveTextContent(text)
    expect(screen.getByRole('table', { name: 'Cost by document' })).toBeInTheDocument()
    const totals = screen.getByText('Total estimated cost').parentElement!
    expect(totals).toHaveTextContent('$1.10')
  })

  it('shows a failed document with no pages, and an upload that was never saved', async () => {
    mockGateway()
    await openIngestion()
    await screen.findByRole('table', { name: 'Documents and their cost' })
    const failed = within(documentsTable()).getByRole('row', { name: /Old scanned code/ })
    expect(failed).toHaveTextContent('Failed')
    const unsaved = within(documentsTable()).getByRole('row', { name: /Upload not saved/ })
    expect(unsaved).toHaveTextContent('Not saved')
  })

  it('reloads for the period and split chosen', async () => {
    const urls = mockGateway()
    await openIngestion()
    await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'month' } })
    await waitFor(() =>
      expect(urls().at(-1)).toBe('/api/usage/ingestion?split=service&range=month'),
    )
    fireEvent.change(screen.getByLabelText('Split each bar by'), { target: { value: 'feature' } })
    await waitFor(() =>
      expect(urls().at(-1)).toBe('/api/usage/ingestion?split=feature&range=month'),
    )
  })

  it('finds a document by its title or file name', async () => {
    mockGateway()
    await openIngestion()
    await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.change(screen.getByLabelText('Find a document'), { target: { value: 'scan.pdf' } })
    const rows = within(documentsTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Old scanned code')
  })

  it('exports what is on screen', async () => {
    mockGateway()
    await openIngestion()
    await screen.findByRole('table', { name: 'Documents and their cost' })
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/ingestion/export.csv?split=service&range=30d',
    )
  })

  it('goes back to report generation', async () => {
    mockGateway()
    await openIngestion()
    await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.click(screen.getByRole('tab', { name: 'Report generation' }))
    expect(await screen.findByText('No AI calls in this period')).toBeInTheDocument()
  })

  it('shows an empty state when nothing was ingested in the period', async () => {
    mockGateway({ ...INGESTION, documents: [], totals: OVERVIEW.totals, pricingBases: [] })
    await openIngestion()
    expect(await screen.findByText('No documents read in this period')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('is not offered to a risk engineer', async () => {
    mockGateway()
    render(<App />)
    await signIn('risk_engineer')
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage and costs' })[0])
    await screen.findByText('No AI calls in this period', {}, { timeout: 15000 })
    expect(screen.queryByRole('tab', { name: 'Ingestion' })).toBeNull()
  })

  it('opens a document from its title: its details, cost per stage, and usage at the rates charged', async () => {
    const urls = mockGateway()
    await openIngestion()
    const table = await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.click(within(table).getByRole('button', { name: /^NFPA 13/ }))

    expect(await screen.findByRole('heading', { name: /^NFPA 13/ })).toBeInTheDocument()
    expect(urls()).toContain('/api/usage/ingestion/d1')
    const about = screen.getByText(/nfpa13\.pdf/)
    for (const text of ['Complete', '40 pages', 'Uploaded 1 Oct 2026'])
      expect(about).toHaveTextContent(text)
    expect(screen.getByText('Total estimated cost').parentElement).toHaveTextContent('$0.6500')
    expect(
      screen.getByRole('table', { name: 'Cost by stage, split by service' }),
    ).toBeInTheDocument()

    const rates = screen.getByRole('table', {
      name: 'Gemini, labelling and self-hosted models: usage and rates',
    })
    expect(
      within(rates)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Feature',
      'Model',
      'Calls',
      'Input tokens',
      'Output tokens',
      'Time per call',
      'Cost',
    ])
    const ocr = within(rates).getByRole('row', { name: /Table and formula OCR/ })
    for (const text of ['gemini-3.8-flash', '400,000', '@ $0.75 / 1M tokens', '1.0 s', '$0.4500'])
      expect(ocr).toHaveTextContent(text)
    expect(within(rates).getByRole('row', { name: /Subtotal/ })).toHaveTextContent('$0.6500')
  })

  it('exports the document’s usage and rates', async () => {
    mockGateway()
    await openIngestion()
    const table = await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.click(within(table).getByRole('button', { name: /^NFPA 13/ }))
    expect(await screen.findByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/usage/ingestion/d1/export.csv',
    )
  })

  it('goes back to every document', async () => {
    mockGateway()
    await openIngestion()
    const table = await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.click(within(table).getByRole('button', { name: /^NFPA 13/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'All documents' }))
    expect(
      await screen.findByRole('table', { name: 'Documents and their cost' }),
    ).toBeInTheDocument()
  })

  it('says so when a document cannot be loaded', async () => {
    mockGateway(INGESTION, () =>
      json(404, { error: 'No AI calls are recorded for that document.' }),
    )
    await openIngestion()
    const table = await screen.findByRole('table', { name: 'Documents and their cost' })
    fireEvent.click(within(table).getByRole('button', { name: /^NFPA 13/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/)
  })
})
