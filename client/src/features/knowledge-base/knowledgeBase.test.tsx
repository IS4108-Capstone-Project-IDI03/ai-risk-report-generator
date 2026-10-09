import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { formatDuration } from './display'
import { resetUploads } from './uploads'

const NFPA = {
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
  status: 'queued',
  error: null,
  unconfirmed: [],
  uploadedAt: '2026-09-29T03:00:00.000Z',
  fileUrl: '/api/knowledge-documents/6abb28ae16068a0793e9962a/file',
}

// A processing document with ingestion progress (E2); overrides tune the stage.
const processing = (overrides: Record<string, unknown> = {}) => ({
  ...NFPA,
  status: 'processing',
  progress: {
    currentStage: 'chunking',
    pageCurrent: 12,
    pageTotal: 45,
    elapsedMs: 90_000,
    currentStageElapsedMs: 20_000,
    stageLog: [],
    ...overrides,
  },
})

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// Answers the upload summary with `list` and each upload by its file name (the
// only thing an upload sends, IN-05); the dashboard's own requests fall back
// to demo data.
function mockGateway(list: unknown[], uploads: Record<string, () => Promise<Response>> = {}) {
  const posted: {
    fileName: string
    query: Record<string, string>
    body: unknown
    type: string | null
  }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/knowledge-documents'))
      return Promise.reject(new TypeError('Failed to fetch'))
    if (init?.method !== 'POST') return json(200, list)
    const query = Object.fromEntries(new URL(url, 'http://x').searchParams)
    const fileName = query.fileName ?? ''
    posted.push({
      fileName,
      query,
      body: init.body,
      type: new Headers(init.headers).get('Content-Type'),
    })
    return (uploads[fileName] ?? (() => json(201, { ...NFPA, fileName })))()
  })
  return posted
}

async function openKnowledgeBase() {
  render(<App />)
  await signIn('knowledge_admin')
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}

// The IN-01 upload panel sits on the Add documents tab (KB-01).
async function openAddDocuments() {
  await openKnowledgeBase()
  fireEvent.click(screen.getByRole('tab', { name: 'Add documents' }))
}

const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })

function choose(...files: File[]) {
  fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files } })
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
  resetUploads()
  vi.unstubAllGlobals()
})

describe('Knowledge base uploads (IN-01, IN-05)', () => {
  it('asks for no details: choosing a PDF uploads it at once with only its file name', async () => {
    const posted = mockGateway([])
    await openAddDocuments()

    choose(pdf('nfpa-13.pdf'))

    const row = screen.getByRole('group', { name: 'nfpa-13.pdf' })
    expect(within(row).queryByLabelText(/Source type/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload all' })).not.toBeInTheDocument()
    expect(await within(row).findByText('Uploaded')).toBeInTheDocument()
    expect(posted).toHaveLength(1)
    expect(posted[0].query).toEqual({ fileName: 'nfpa-13.pdf' })
    expect(posted[0].type).toBe('application/pdf')
    expect(posted[0].body).toBeInstanceOf(File)
  })

  it('uploads a dropped PDF the same way', async () => {
    const posted = mockGateway([])
    await openAddDocuments()

    fireEvent.drop(screen.getByRole('region', { name: 'Add documents' }), {
      dataTransfer: { files: [pdf('dropped.pdf')] },
    })

    expect(
      await within(screen.getByRole('group', { name: 'dropped.pdf' })).findByText('Uploaded'),
    ).toBeInTheDocument()
    expect(posted[0].query).toEqual({ fileName: 'dropped.pdf' })
  })

  it('shows "Reading document details…" on a file while its request is pending, then its status', async () => {
    let finish: (response: Response) => void = () => {}
    mockGateway([], { 'slow.pdf': () => new Promise<Response>((resolve) => (finish = resolve)) })
    await openAddDocuments()

    choose(pdf('slow.pdf'))

    const row = screen.getByRole('group', { name: 'slow.pdf' })
    expect(within(row).getByText('Reading document details…')).toBeInTheDocument()
    expect(within(row).queryByText('Uploaded')).not.toBeInTheDocument()

    finish(await json(201, NFPA))
    expect(await within(row).findByText('Uploaded')).toBeInTheDocument()
    expect(within(row).queryByText('Reading document details…')).not.toBeInTheDocument()
  })

  it('uploads each file on its own; a rejected file shows its reason and the others go through', async () => {
    const posted = mockGateway([], {
      'broken.pdf': () => json(422, { error: 'The PDF is password-protected.' }),
    })
    await openAddDocuments()

    choose(pdf('nfpa-13.pdf'), pdf('broken.pdf'))
    const good = screen.getByRole('group', { name: 'nfpa-13.pdf' })
    const bad = screen.getByRole('group', { name: 'broken.pdf' })

    expect(await within(bad).findByText('The PDF is password-protected.')).toBeInTheDocument()
    expect(within(bad).getByText('Rejected')).toBeInTheDocument()
    // Live ingestion status belongs to the uploaded documents list, so the row
    // only says the upload went through.
    expect(await within(good).findByText('Uploaded')).toBeInTheDocument()
    expect(posted.map((p) => p.fileName).sort()).toEqual(['broken.pdf', 'nfpa-13.pdf'])
  })

  it("rejects an identical file with the gateway's message naming the stored document (IN-07)", async () => {
    const message = 'Already in the knowledge base as NFPA 13 (2019 edition), Withdrawn.'
    const posted = mockGateway([], { 'same.pdf': () => json(409, { error: message }) })
    await openAddDocuments()

    choose(pdf('same.pdf'))
    const row = screen.getByRole('group', { name: 'same.pdf' })
    expect(await within(row).findByText(message)).toBeInTheDocument()
    expect(within(row).getByText('Rejected')).toBeInTheDocument()
    // A different file is the fix, so there is nothing to retry.
    expect(within(row).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(posted).toHaveLength(1)
  })

  it('keeps a file whose upload failed so it can be tried again', async () => {
    let up = false
    mockGateway([], {
      'flaky.pdf': () => (up ? json(201, NFPA) : json(503, { error: 'Ingestion is unavailable.' })),
    })
    await openAddDocuments()

    choose(pdf('flaky.pdf'))
    const row = screen.getByRole('group', { name: 'flaky.pdf' })
    expect(await within(row).findByText('Ingestion is unavailable.')).toBeInTheDocument()

    up = true
    fireEvent.click(within(row).getByRole('button', { name: 'Try again' }))
    expect(await within(row).findByText('Uploaded')).toBeInTheDocument()
  })

  it('lists uploaded documents with their status, failure reason and original file', async () => {
    mockGateway([
      { ...NFPA, status: 'failed', error: 'Docling could not parse nfpa-13.pdf' },
      { ...NFPA, id: 'b', title: 'FM Global 2-0', status: 'complete' },
    ])
    await openAddDocuments()

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    await within(table).findByText('Failed')
    expect(within(table).getByText('Failed')).toBeInTheDocument()
    expect(within(table).getByText('Docling could not parse nfpa-13.pdf')).toBeInTheDocument()
    expect(within(table).getByText('Complete')).toBeInTheDocument()
    expect(
      within(table).getByText(
        'Complete uploads leave this list after 24 hours, failed or cancelled ones after 7 days.',
      ),
    ).toBeInTheDocument()
    expect(within(table).getAllByRole('link', { name: /View original/ })[0]).toHaveAttribute(
      'href',
      NFPA.fileUrl,
    )
  })

  it('marks a finished upload with an Unconfirmed detail Needs review', async () => {
    mockGateway([
      { ...NFPA, status: 'complete', jurisdiction: null, unconfirmed: ['jurisdiction'] },
      {
        ...NFPA,
        id: 'q',
        title: 'Still ingesting',
        jurisdiction: null,
        unconfirmed: ['jurisdiction'],
      },
    ])
    await openAddDocuments()

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    const done = (await within(table).findByText(NFPA.title)).closest('tr, li') as HTMLElement
    // One badge: Needs review stands in for Complete, with the reason under the title.
    expect(within(done).getByText('Needs review')).toBeInTheDocument()
    expect(within(done).queryByText('Complete')).not.toBeInTheDocument()
    expect(within(done).getByText('Unconfirmed details')).toBeInTheDocument()
    // The badge is the way in: it opens the document's Review page.
    fireEvent.click(within(done).getByRole('button', { name: `Needs review: ${NFPA.title}` }))
    expect(window.location.pathname).toBe(`/admin/knowledge-base/review/${NFPA.id}`)
    window.history.replaceState(null, '', '/admin/knowledge-base')
    // Until it finishes ingesting it is not in the knowledge base, so nothing to review yet.
    const queued = within(table).getByText('Still ingesting').closest('tr, li') as HTMLElement
    expect(within(queued).queryByText('Needs review')).not.toBeInTheDocument()
  })

  it('marks a finished upload that matches a stored document Needs review and says why (IN-07)', async () => {
    mockGateway([
      {
        ...NFPA,
        status: 'complete',
        match: {
          kind: 'newer_edition',
          document: { id: 'old', title: 'NFPA 13', edition: '2019', withdrawn: false },
          newMatched: 92,
          newTotal: 98,
          storedMatched: 92,
          storedTotal: 120,
          otherNeedsReview: false,
        },
      },
    ])
    await openAddDocuments()

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(table).findByText('Needs review')).toBeInTheDocument()
    expect(
      within(table).getByText('Possible newer edition of NFPA 13 (2019 edition)'),
    ).toBeInTheDocument()
  })

  it('describes a standard by its edition and a Marsh report by its facility type and date', async () => {
    mockGateway([
      NFPA,
      {
        ...NFPA,
        id: 'r',
        title: 'Cold store risk survey',
        issuingBody: 'Marsh',
        edition: null,
        sourceType: 'marsh_report',
        facilityType: 'Cold store',
        effectiveDate: '2024-03-12',
      },
    ])
    await openAddDocuments()

    const table = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(
      await within(table).findByText('NFPA · 2022 Edition · NFPA standard'),
    ).toBeInTheDocument()
    expect(within(table).getByText('Marsh report · Cold store · 12 Mar 2024')).toBeInTheDocument()
  })

  it('keeps upload outcomes when you leave the screen and come back', async () => {
    mockGateway([], { 'broken.pdf': () => json(415, { error: 'Only PDF files can be uploaded.' }) })
    await openAddDocuments()
    choose(pdf('broken.pdf'))
    await screen.findByText('Only PDF files can be uploaded.')

    fireEvent.click(screen.getAllByRole('button', { name: /^Dashboard/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])

    expect(await screen.findByText('Only PDF files can be uploaded.')).toBeInTheDocument()
  })
})

describe('Ingestion stage tracking (E2)', () => {
  it('shows the stage and the page reached for a chunking document', async () => {
    mockGateway([processing({ currentStage: 'chunking', pageCurrent: 12, pageTotal: 45 })])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Chunking')).toBeInTheDocument()
    expect(within(region).getByText('| Pg 12 / 45')).toBeInTheDocument()
  })

  it('shows the page without a total when the page count is unknown', async () => {
    mockGateway([processing({ currentStage: 'chunking', pageCurrent: 12, pageTotal: null })])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('| Pg 12')).toBeInTheDocument()
  })

  it('falls back to the Processing badge when a processing document has no progress yet', async () => {
    // The worker has not written its first stage: no progress field at all.
    mockGateway([{ ...NFPA, status: 'processing' }])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Processing')).toBeInTheDocument()
    expect(within(region).queryByText(/Pg/)).not.toBeInTheDocument()
  })

  it('shows no stage detail for a queued document', async () => {
    mockGateway([{ ...NFPA, status: 'queued' }])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Queued')).toBeInTheDocument()
    expect(within(region).queryByText(/Pg/)).not.toBeInTheDocument()
  })

  it('formats a processing duration as minutes and seconds', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(45_000)).toBe('45s')
  })
})
