// The knowledge base's Documents tab (KB-01): browse active documents by
// group, filter by label, and correct a document's details. The gateway is a
// stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'

const doc = {
  issuingBody: 'NFPA',
  fileName: 'x.pdf',
  size: 2048,
  sha256: 'abc',
  status: 'complete',
  error: null,
  uploadedAt: '2026-09-29T03:00:00.000Z',
}
const FM = {
  ...doc,
  id: 'fm',
  title: 'FM 2-0 Installation guidelines',
  issuingBody: 'FM Global',
  edition: '2024',
  sourceType: 'fm_standard',
  jurisdiction: 'all',
  facilityType: 'all',
  effectiveDate: '2024-01-01',
  fileUrl: '/api/knowledge-documents/fm/file',
}
const NFPA = {
  ...doc,
  id: 'nfpa',
  title: 'NFPA 13 sprinkler standard',
  edition: '2022',
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
  facilityType: 'Cold store',
  effectiveDate: '2022-01-01',
  fileUrl: '/api/knowledge-documents/nfpa/file',
}
const REPORT = {
  ...doc,
  id: 'report',
  title: 'Cold store risk survey',
  issuingBody: 'Marsh',
  edition: null,
  sourceType: 'marsh_report',
  jurisdiction: 'MY',
  facilityType: 'Cold store',
  effectiveDate: '2024-03-12',
  fileUrl: '/api/knowledge-documents/report/file',
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// Answers the active list with `active`, and each correction with `onPut`;
// returns the corrections sent. Other requests fail, so screens fall back to
// demo data.
function mockGateway(
  active: object[],
  onPut: (id: string, body: Record<string, string>) => Promise<Response> = () => json(500, {}),
) {
  const puts: { id: string; body: Record<string, string> }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/knowledge-documents/active') return json(200, active)
    const id = url.match(/^\/api\/knowledge-documents\/([^/]+)$/)?.[1]
    if (id && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      puts.push({ id, body })
      return onPut(id, body)
    }
    if (url.startsWith('/api/knowledge-documents')) return json(200, [])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  return puts
}

function openKnowledgeBase() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}

const group = (name: string) => screen.findByRole('region', { name })
const filter = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

// Opens a document's Edit details dialog.
async function edit(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit details of ${title}` }))
  return screen.getByRole('dialog', { name: 'Edit details' })
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

describe('Knowledge base documents (KB-01)', () => {
  it('opens on the documents, grouped under FM standards, NFPA standards and past Marsh reports', async () => {
    mockGateway([FM, NFPA, REPORT])
    openKnowledgeBase()

    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true')
    expect(within(await group('FM standards')).getByText(FM.title)).toBeInTheDocument()
    expect(within(await group('NFPA standards')).getByText(NFPA.title)).toBeInTheDocument()
    expect(within(await group('Past Marsh reports')).getByText(REPORT.title)).toBeInTheDocument()
  })

  it('shows each document’s edition or report date, country, facility type, status and original', async () => {
    mockGateway([FM, REPORT])
    openKnowledgeBase()

    const standards = await group('FM standards')
    expect(within(standards).getByText('FM Global · 2024 Edition')).toBeInTheDocument()
    expect(within(standards).getByText('All countries')).toBeInTheDocument()
    expect(within(standards).getByText('All facility types')).toBeInTheDocument()
    expect(within(standards).getByText('Active')).toBeInTheDocument()
    const reports = await group('Past Marsh reports')
    expect(within(reports).getByText('Report date 12 Mar 2024')).toBeInTheDocument()
    expect(within(reports).getByText('Malaysia')).toBeInTheDocument()
    expect(within(reports).getByText('Cold store')).toBeInTheDocument()
    expect(
      within(reports).getByRole('link', { name: `View original of ${REPORT.title}` }),
    ).toHaveAttribute('href', REPORT.fileUrl)
  })

  it('says which group is empty', async () => {
    mockGateway([FM])
    openKnowledgeBase()

    expect(
      within(await group('NFPA standards')).getByText('No NFPA standards yet.'),
    ).toBeInTheDocument()
  })

  it('filters by exact label value, so All countries shows only documents for all countries', async () => {
    mockGateway([FM, NFPA, REPORT])
    openKnowledgeBase()
    await group('FM standards')

    filter('Country', 'all')
    expect(screen.getByText(FM.title)).toBeInTheDocument()
    expect(screen.queryByText(NFPA.title)).not.toBeInTheDocument()

    filter('Country', '')
    filter('Facility type', 'Cold store')
    expect(screen.queryByText(FM.title)).not.toBeInTheDocument()
    expect(screen.getByText(NFPA.title)).toBeInTheDocument()
    expect(screen.getByText(REPORT.title)).toBeInTheDocument()
    expect(screen.getByText('2 of 3 documents')).toBeInTheDocument()
  })

  it('says no documents match, and Clear filters brings them back', async () => {
    mockGateway([FM, NFPA])
    openKnowledgeBase()
    await group('FM standards')

    filter('Country', 'TH')

    expect(screen.getByText('No documents match these filters')).toBeInTheDocument()
    expect(screen.queryByText(FM.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    expect(screen.getByText(FM.title)).toBeInTheDocument()
  })

  it('saves a corrected label and shows the corrected value', async () => {
    const puts = mockGateway([REPORT], (id) => json(200, { ...REPORT, id, jurisdiction: 'SG' }))
    openKnowledgeBase()
    const dialog = await edit(REPORT.title)
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue(REPORT.title)

    fireEvent.change(within(dialog).getByLabelText(/^Country/), { target: { value: 'SG' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(
      await within(await group('Past Marsh reports')).findByText('Singapore'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(puts).toEqual([
      {
        id: 'report',
        body: {
          sourceType: 'marsh_report',
          title: REPORT.title,
          effectiveDate: '2024-03-12',
          jurisdiction: 'SG',
          facilityType: 'Cold store',
        },
      },
    ])
  })

  it('confirms a saved correction', async () => {
    mockGateway([REPORT], (id) => json(200, { ...REPORT, id, jurisdiction: 'SG' }))
    openKnowledgeBase()
    const dialog = await edit(REPORT.title)

    fireEvent.change(within(dialog).getByLabelText(/^Country/), { target: { value: 'SG' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(
      await screen.findByText('Details saved. Search now uses the corrected labels.'),
    ).toBeInTheDocument()
  })

  it('moves a document to its new group when its source type is corrected', async () => {
    mockGateway([NFPA], (id, body) =>
      json(200, { ...NFPA, id, sourceType: body.sourceType, issuingBody: 'FM Global' }),
    )
    openKnowledgeBase()
    const dialog = await edit(NFPA.title)

    fireEvent.change(within(dialog).getByLabelText(/^Source type/), {
      target: { value: 'fm_standard' },
    })
    fireEvent.change(within(dialog).getByLabelText(/^Edition/), { target: { value: '2022' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(await within(await group('FM standards')).findByText(NFPA.title)).toBeInTheDocument()
  })

  it('shows why a value was refused, keeps the dialog open, and leaves the old value', async () => {
    mockGateway([REPORT], () =>
      json(400, {
        error: 'The document details are invalid.',
        fields: { facilityType: 'Choose a facility type from the list.' },
      }),
    )
    openKnowledgeBase()
    const dialog = await edit(REPORT.title)

    fireEvent.change(within(dialog).getByLabelText(/^Facility type/), {
      target: { value: 'Data centre' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(
      await within(dialog).findByText('Choose a facility type from the list.'),
    ).toBeInTheDocument()
    expect(within(await group('Past Marsh reports')).getByText('Cold store')).toBeInTheDocument()
  })

  it('shows the reason when search could not be updated', async () => {
    mockGateway([REPORT], () =>
      json(503, {
        error: 'Search could not be updated, so the correction was not saved. Try again shortly.',
      }),
    )
    openKnowledgeBase()
    const dialog = await edit(REPORT.title)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(
      await within(dialog).findByText(
        'Search could not be updated, so the correction was not saved. Try again shortly.',
      ),
    ).toBeInTheDocument()
  })

  it('checks a standard’s edition before sending anything', async () => {
    const puts = mockGateway([NFPA])
    openKnowledgeBase()
    const dialog = await edit(NFPA.title)

    fireEvent.change(within(dialog).getByLabelText(/^Edition/), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }))

    expect(await within(dialog).findByText('Edition is required.')).toBeInTheDocument()
    expect(puts).toEqual([])
  })

  it('saves nothing when you cancel', async () => {
    const puts = mockGateway([REPORT])
    openKnowledgeBase()
    const dialog = await edit(REPORT.title)

    fireEvent.change(within(dialog).getByLabelText(/^Country/), { target: { value: 'SG' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(puts).toEqual([])
    expect(within(await group('Past Marsh reports')).getByText('Malaysia')).toBeInTheDocument()
  })
})
