import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadedDocuments } from './components/UploadedDocuments'

afterEach(cleanup)

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const noContent = (status = 202) => Promise.resolve(new Response(null, { status }))

const FAILED = {
  id: '6abb28ae16068a0793e9962a',
  title: 'NFPA 13 sprinkler standard',
  issuingBody: 'NFPA',
  edition: '2022',
  fileName: 'nfpa-13.pdf',
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
  facilityType: 'all',
  effectiveDate: '2022-01-01',
  size: 2048,
  sha256: 'abc',
  status: 'failed',
  error: 'Processing stopped on a system error, not a fault in the file. Upload it again.',
  uploadedAt: '2026-09-29T03:00:00.000Z',
  fileUrl: '/api/knowledge-documents/6abb28ae16068a0793e9962a/file',
  unconfirmed: [],
  history: [],
  withdrawn: null,
}
const COMPLETE = { ...FAILED, id: 'done', title: 'FM Global 2-0', status: 'complete', error: null }
const CANCELLED = {
  ...FAILED,
  id: 'cancelled',
  title: 'Cancelled standard',
  status: 'cancelled',
  error: null,
}
const onCompleted = () => undefined

// Serves the uploads list, flipping the failed document to queued once its
// retry has been posted — the way the gateway would after a successful retry.
// Records retry posts so a test can assert them.
function stubGateway(initial: Record<string, unknown>[]) {
  const state = { list: initial, retried: [] as string[], cancelled: [] as string[] }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const retry = url.match(/\/api\/knowledge-documents\/([^/]+)\/retry$/)
    if (retry && method === 'POST') {
      const id = retry[1]
      state.retried.push(id)
      state.list = state.list.map((d) =>
        d.id === id ? { ...d, status: 'queued', error: null } : d,
      )
      return noContent(202)
    }
    const cancel = url.match(/\/api\/knowledge-documents\/([^/]+)\/cancel$/)
    if (cancel && method === 'POST') {
      const id = cancel[1]
      state.cancelled.push(id)
      state.list = state.list.map((d) =>
        d.id === id ? { ...d, status: 'cancelled', error: null } : d,
      )
      return noContent(202)
    }
    if (url.startsWith('/api/knowledge-documents')) return json(state.list)
    return Promise.reject(new TypeError('unexpected url ' + url))
  })
  vi.stubGlobal('fetch', fetchMock)
  return state
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('UploadedDocuments retry', () => {
  it('shows a Retry button on a failed document', async () => {
    stubGateway([FAILED])
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )

    expect(await screen.findByText('NFPA 13 sprinkler standard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows no Retry button on a complete document', async () => {
    stubGateway([COMPLETE])
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )

    expect(await screen.findByText('FM Global 2-0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('posts the retry and refreshes, so the row returns as queued', async () => {
    const state = stubGateway([FAILED])
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )
    await screen.findByText('NFPA 13 sprinkler standard')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // The retry was posted for this document, and the refreshed list shows it
    // queued — so the Retry button is gone and the status reads Queued.
    await waitFor(() => expect(state.retried).toEqual([FAILED.id]))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('surfaces an error and keeps the Retry button when the gateway rejects', async () => {
    stubGateway([FAILED])
    // Override: the retry call fails.
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/retry') && (init?.method ?? 'GET') === 'POST')
        return json({ error: 'nope' }, 503)
      return json([FAILED])
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )
    await screen.findByText('NFPA 13 sprinkler standard')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Retry not started')).toBeInTheDocument()
    // The row is still failed, so its Retry button is still there.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument())
  })

  it('offers Retry in the stacked (narrow) layout too', async () => {
    stubGateway([FAILED])
    render(
      <UploadedDocuments
        narrow={true}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )

    const list = await screen.findByRole('list', { name: 'Recent uploads' })
    expect(within(list).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('UploadedDocuments cancellation', () => {
  it('shows Stop only for queued and processing documents', async () => {
    stubGateway([
      { ...FAILED, id: 'queued', title: 'Queued standard', status: 'queued', error: null },
      {
        ...FAILED,
        id: 'processing',
        title: 'Processing standard',
        status: 'processing',
        error: null,
      },
      FAILED,
      COMPLETE,
      CANCELLED,
    ])
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(within(table).getAllByRole('button', { name: 'Stop' })).toHaveLength(2)
    expect(within(table).getAllByRole('button', { name: 'Retry' })).toHaveLength(2)
  })

  it('posts cancellation and refreshes the row as cancelled with Retry', async () => {
    const state = stubGateway([
      { ...FAILED, id: 'queued', title: 'Queued standard', status: 'queued', error: null },
    ])
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )
    const table = await screen.findByRole('region', { name: 'Recent uploads' })

    fireEvent.click(within(table).getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(state.cancelled).toEqual(['queued']))
    expect(await within(table).findByText('Cancelled')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('surfaces a cancellation error and keeps Stop when the gateway rejects', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/cancel') && (init?.method ?? 'GET') === 'POST')
        return json({ error: 'nope' }, 503)
      return json([
        { ...FAILED, id: 'queued', title: 'Queued standard', status: 'queued', error: null },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <UploadedDocuments
        narrow={false}
        refreshKey={0}
        onCompleted={onCompleted}
        onReview={() => undefined}
      />,
    )

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    fireEvent.click(within(table).getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stop not started')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(table).getByRole('button', { name: 'Stop' })).toBeInTheDocument(),
    )
  })
})
