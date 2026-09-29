import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { resetUploads } from './uploads'

const NFPA = {
  id: '6abb28ae16068a0793e9962a',
  title: 'NFPA 13 sprinkler standard',
  issuingBody: 'NFPA',
  edition: '2022 Edition',
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
  const posted: { title: string; body: unknown; type: string | null }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/knowledge-documents'))
      return Promise.reject(new TypeError('Failed to fetch'))
    if (init?.method !== 'POST') return json(200, list)
    const title = new URL(url, 'http://x').searchParams.get('title') ?? ''
    posted.push({
      title,
      body: init.body,
      type: new Headers(init.headers).get('Content-Type'),
    })
    return (uploads[title] ?? (() => json(201, { ...NFPA, title })))()
  })
  return posted
}

function openKnowledgeBase() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}

const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })

function choose(...files: File[]) {
  fireEvent.change(screen.getByLabelText(/Choose PDF files/), { target: { files } })
}

// Fills every required detail on a file's row; the title comes from the file name.
function fillDetails(fileName: string) {
  const row = screen.getByRole('group', { name: fileName })
  const set = (label: RegExp, value: string) =>
    fireEvent.change(within(row).getByLabelText(label), { target: { value } })
  set(/^Issuing body/, 'NFPA')
  set(/^Edition/, '2022 Edition')
  set(/^Effective date/, '2022-01-01')
  set(/^Source type/, 'nfpa_standard')
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
  it('gives each selected PDF its own row of details, titled from its file name', async () => {
    mockGateway([])
    openKnowledgeBase()

    choose(pdf('nfpa-13.pdf'), pdf('FM 2-0.pdf'))

    const rows = screen.getAllByRole('group')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['nfpa-13.pdf', 'FM 2-0.pdf'])
    expect(within(rows[1]).getByLabelText(/^Title/)).toHaveValue('FM 2-0')
    expect(within(rows[0]).getByLabelText(/^Country/)).toHaveValue('SG')
  })

  it('uploads each file on its own; a rejected file shows its reason and the others go through', async () => {
    const posted = mockGateway([], {
      broken: () => json(422, { error: 'The PDF is password-protected.' }),
    })
    openKnowledgeBase()
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
    openKnowledgeBase()
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
    openKnowledgeBase()

    const table = await screen.findByRole('region', { name: 'Uploaded documents' })
    await within(table).findByText('Failed')
    expect(within(table).getByText('Failed')).toBeInTheDocument()
    expect(within(table).getByText('Docling could not parse nfpa-13.pdf')).toBeInTheDocument()
    expect(within(table).getByText('Complete')).toBeInTheDocument()
    expect(within(table).getAllByRole('link', { name: /View original/ })[0]).toHaveAttribute(
      'href',
      NFPA.fileUrl,
    )
  })

  it('keeps upload outcomes when you leave the screen and come back', async () => {
    mockGateway([], { broken: () => json(415, { error: 'Only PDF files can be uploaded.' }) })
    openKnowledgeBase()
    choose(pdf('broken.pdf'))
    fillDetails('broken.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Upload all' }))
    await screen.findByText('Only PDF files can be uploaded.')

    fireEvent.click(screen.getAllByRole('button', { name: /^Dashboard/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])

    expect(await screen.findByText('Only PDF files can be uploaded.')).toBeInTheDocument()
  })
})
