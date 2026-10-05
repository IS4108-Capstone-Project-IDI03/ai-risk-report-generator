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
  uploadedAt: '2026-09-29T03:00:00.000Z',
  fileUrl: '/api/knowledge-documents/6abb28ae16068a0793e9962a/file',
}

const EDITION_RANGE = `Edition must be a year from 1900 to ${new Date().getFullYear() + 1}.`

// A processing document with ingestion progress (E2); overrides tune the stage.
const processing = (overrides: Record<string, unknown> = {}) => ({
  ...NFPA,
  status: 'processing',
  progress: {
    currentStage: 'chunking',
    isOcr: false,
    chunksCompleted: 42,
    chunksTotal: null,
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

// Answers the upload summary with `list` and each upload by its title; the
// dashboard's own requests fall back to demo data.
function mockGateway(list: unknown[], uploads: Record<string, () => Promise<Response>> = {}) {
  const posted: {
    title: string
    query: Record<string, string>
    body: unknown
    type: string | null
  }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/knowledge-documents'))
      return Promise.reject(new TypeError('Failed to fetch'))
    if (init?.method !== 'POST') return json(200, list)
    const query = Object.fromEntries(new URL(url, 'http://x').searchParams)
    const title = query.title ?? ''
    posted.push({
      title,
      query,
      body: init.body,
      type: new Headers(init.headers).get('Content-Type'),
    })
    return (uploads[title] ?? (() => json(201, { ...NFPA, title })))()
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

const setField = (row: HTMLElement, label: RegExp, value: string) =>
  fireEvent.change(within(row).getByLabelText(label), { target: { value } })

// Fills every required detail of a standard on a file's row; the title comes
// from the file name.
function fillDetails(fileName: string) {
  const row = screen.getByRole('group', { name: fileName })
  setField(row, /^Source type/, 'nfpa_standard')
  setField(row, /^Edition/, '2022')
  setField(row, /^Effective date/, '2022-01-01')
  return row
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

describe('Knowledge base uploads (IN-01)', () => {
  it('gives each selected PDF its own row, asking first for its source type', async () => {
    mockGateway([])
    await openAddDocuments()

    choose(pdf('nfpa-13.pdf'), pdf('FM 2-0.pdf'))

    const rows = screen.getAllByRole('group')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['nfpa-13.pdf', 'FM 2-0.pdf'])
    expect(within(rows[1]).getByLabelText(/^Source type/)).toHaveValue('')
    expect(within(rows[1]).queryByLabelText(/^Title/)).not.toBeInTheDocument()

    setField(rows[1], /^Source type/, 'fm_standard')
    expect(within(rows[1]).getByLabelText(/^Title/)).toHaveValue('FM 2-0')
  })

  it('asks a standard for its edition, and a Marsh report for its report date and facility type', async () => {
    mockGateway([])
    await openAddDocuments()
    choose(pdf('survey.pdf'))
    const row = screen.getByRole('group', { name: 'survey.pdf' })

    setField(row, /^Source type/, 'nfpa_standard')
    setField(row, /^Edition/, '2022')
    expect(within(row).getByLabelText(/^Country/)).toHaveValue('all')
    expect(within(row).queryByLabelText(/^Report date/)).not.toBeInTheDocument()

    setField(row, /^Source type/, 'marsh_report')
    expect(within(row).queryByLabelText(/^Edition/)).not.toBeInTheDocument()
    expect(within(row).queryByLabelText(/^Issuing body/)).not.toBeInTheDocument()
    expect(within(row).getByLabelText(/^Report date/)).toBeInTheDocument()
    expect(within(row).getByLabelText(/^Country/)).toHaveValue('SG')
    expect(within(row).getByLabelText(/^Facility type/)).toHaveValue('')

    // Switching back starts the standard's own details afresh.
    setField(row, /^Source type/, 'nfpa_standard')
    expect(within(row).getByLabelText(/^Edition/)).toHaveValue(null)
  })

  it("keeps a standard's edition to four digits and flags a year out of range as you type", async () => {
    mockGateway([])
    await openAddDocuments()
    choose(pdf('nfpa-13.pdf'))
    const row = screen.getByRole('group', { name: 'nfpa-13.pdf' })
    setField(row, /^Source type/, 'nfpa_standard')

    setField(row, /^Edition/, '20225')
    expect(within(row).getByLabelText(/^Edition/)).toHaveValue(2022)
    expect(within(row).queryByText(EDITION_RANGE)).not.toBeInTheDocument()

    setField(row, /^Edition/, '3000')
    expect(within(row).getByText(EDITION_RANGE)).toBeInTheDocument()
  })

  it.each([
    ['missing', '', 'Edition is required.'],
    ['out of range', '1850', EDITION_RANGE],
  ])('does not upload a standard whose edition is %s', async (_case, edition, message) => {
    const posted = mockGateway([])
    await openAddDocuments()
    choose(pdf('nfpa-13.pdf'))
    const row = fillDetails('nfpa-13.pdf')
    setField(row, /^Edition/, edition)

    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))

    expect(await within(row).findByText(message)).toBeInTheDocument()
    expect(within(row).getByLabelText(/^Edition/)).toBeEnabled()
    expect(posted).toEqual([])
  })

  it("sends only a Marsh report's own details", async () => {
    const posted = mockGateway([])
    await openAddDocuments()
    choose(pdf('survey.pdf'))
    const row = screen.getByRole('group', { name: 'survey.pdf' })
    setField(row, /^Source type/, 'nfpa_standard')
    setField(row, /^Edition/, '2022')
    setField(row, /^Source type/, 'marsh_report')
    setField(row, /^Report date/, '2024-03-12')
    setField(row, /^Facility type/, 'Cold store')

    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))

    expect(await within(row).findByText('Uploaded')).toBeInTheDocument()
    expect(posted[0].query).toEqual({
      fileName: 'survey.pdf',
      title: 'survey',
      effectiveDate: '2024-03-12',
      sourceType: 'marsh_report',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
    })
  })

  it('uploads each file on its own; a rejected file shows its reason and the others go through', async () => {
    const posted = mockGateway([], {
      broken: () => json(422, { error: 'The PDF is password-protected.' }),
    })
    await openAddDocuments()
    choose(pdf('nfpa-13.pdf'), pdf('broken.pdf'))
    const good = fillDetails('nfpa-13.pdf')
    const bad = fillDetails('broken.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))

    expect(await within(bad).findByText('The PDF is password-protected.')).toBeInTheDocument()
    expect(within(bad).getByText('Rejected')).toBeInTheDocument()
    // Live ingestion status belongs to the uploaded documents list, so the row
    // only says the upload went through.
    expect(await within(good).findByText('Uploaded')).toBeInTheDocument()
    expect(posted.map((p) => p.title).sort()).toEqual(['broken', 'nfpa-13'])
    expect(posted[0].type).toBe('application/pdf')
    expect(posted[0].body).toBeInstanceOf(File)
  })

  it('shows the fields the gateway refused on that file’s row', async () => {
    mockGateway([], {
      'nfpa-13': () =>
        json(400, {
          error: 'The document details are invalid.',
          fields: { edition: 'Edition is required.' },
        }),
    })
    await openAddDocuments()
    choose(pdf('nfpa-13.pdf'))
    const row = fillDetails('nfpa-13.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))

    expect(await within(row).findByText('Edition is required.')).toBeInTheDocument()
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
        'Complete uploads leave this list after 24 hours, failed ones after 7 days.',
      ),
    ).toBeInTheDocument()
    expect(within(table).getAllByRole('link', { name: /View original/ })[0]).toHaveAttribute(
      'href',
      NFPA.fileUrl,
    )
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
    mockGateway([], { broken: () => json(415, { error: 'Only PDF files can be uploaded.' }) })
    await openAddDocuments()
    choose(pdf('broken.pdf'))
    fillDetails('broken.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))
    await screen.findByText('Only PDF files can be uploaded.')

    fireEvent.click(screen.getAllByRole('button', { name: /^Dashboard/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])

    expect(await screen.findByText('Only PDF files can be uploaded.')).toBeInTheDocument()
  })
})


describe('Ingestion stage tracking (E2)', () => {
  it('shows the stage and a running chunk count for a chunking document', async () => {
    mockGateway([processing({ currentStage: 'chunking', chunksCompleted: 42 })])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Chunking')).toBeInTheDocument()
    expect(within(region).getByText('42 chunks')).toBeInTheDocument()
  })

  it('marks an OCR-heavy parse as "Parsing · OCR"', async () => {
    mockGateway([processing({ currentStage: 'parsing', isOcr: true })])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Parsing · OCR')).toBeInTheDocument()
  })

  it('falls back to the Processing badge when a processing document has no progress yet', async () => {
    // The worker has not written its first stage: no progress field at all.
    mockGateway([{ ...NFPA, status: 'processing' }])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Processing')).toBeInTheDocument()
    expect(within(region).queryByText(/chunks/)).not.toBeInTheDocument()
  })

  it('shows no stage detail for a queued document', async () => {
    mockGateway([{ ...NFPA, status: 'queued' }])
    await openAddDocuments()

    const region = await screen.findByRole('region', { name: 'Recent uploads' })
    expect(await within(region).findByText('Queued')).toBeInTheDocument()
    expect(within(region).queryByText(/chunks/)).not.toBeInTheDocument()
  })

  it('formats a processing duration as minutes and seconds', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(45_000)).toBe('45s')
  })
})
