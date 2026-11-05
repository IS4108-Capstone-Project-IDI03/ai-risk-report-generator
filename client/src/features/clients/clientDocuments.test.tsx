// The client page's Documents tab and the Clients table facts (CP-23 AC13,
// AC14): listing, opening and deleting documents. Drives App through a stubbed gateway.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { ClientDocument } from './api'
import { clientFacts } from './clientFacts'
import { ClientAvatar } from './components/ClientAvatar'

// CP-23: the client page's Documents tab (AC13, AC14) and the Clients table.

beforeAll(() => {
  // jsdom has no native modal implementation.
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
  window.history.replaceState(null, '', '/')
})

const allowed = { allowed: true, reason: null }
const SITE = {
  id: 's1',
  code: 'SITE-0001',
  name: 'Kent Ridge campus',
  address: '21 Lower Kent Ridge Road',
  jurisdiction: 'SG',
  facilityType: 'Office',
  edited: null,
  removed: null,
  removedWithClient: false,
  nameTaken: false,
  assessments: 1,
  change: allowed,
  remove: allowed,
  restore: { allowed: false, reason: null },
  visits: [
    {
      reference: 'RPT-2026-0412',
      siteVisitDate: '2099-03-12',
      surveyType: 'First survey',
      reportDueDate: null,
      status: 'capturing',
    },
  ],
}
const PAGE = {
  id: 'c1',
  name: 'NUS',
  division: 'Education',
  edited: null,
  removed: false,
  rename: allowed,
  remove: allowed,
  removedWithClient: 0,
  restore: { allowed: false, reason: null },
  sites: [SITE],
}
// Due long ago, so overdue; surveyed far ahead, so the next survey.
const WORK_LIST = [
  {
    id: 'id-1',
    reference: 'RPT-2026-0412',
    client: 'NUS',
    clientId: 'c1',
    surveyType: 'Property risk survey',
    siteVisitDate: '2099-03-12',
    reportDueDate: '2020-01-01',
    engineer: { id: '6ab39017e45cf009e4507731', name: 'Alex Rowe' },
    status: 'capturing',
    captureStartedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    site: { ...SITE, removed: false, change: { ...allowed, assessments: 1 } },
  },
]

const doc = (
  id: string,
  name: string,
  tag: string,
  placement: ClientDocument['placement'],
  origin: ClientDocument['origin'] = 'intake',
): ClientDocument => ({
  id,
  name,
  contentType: 'application/pdf',
  size: 1800,
  placement,
  tag,
  origin,
  originLabel: origin === 'upload' ? 'Uploaded by Alex Rowe' : 'From client documents',
  uploadedAt: '2026-10-05T08:00:00.000Z',
  uploadedBy: { id: 'u1', name: 'Alex Rowe' },
})
const SITE_PLACEMENT = { kind: 'site', siteId: 's1', siteName: 'Kent Ridge campus' } as const
const DOCS = [
  doc('d3', 'Visit notes.pdf', 'RPT-2026-0412 · Kent Ridge campus', {
    kind: 'assessment',
    assessmentId: 'a1',
    reference: 'RPT-2026-0412',
    siteId: 's1',
    siteName: 'Kent Ridge campus',
  }),
  doc('d2', 'Site plan.pdf', 'Kent Ridge campus', SITE_PLACEMENT, 'upload'),
  doc('d1', 'Engagement letter.pdf', 'Whole client', { kind: 'client' }),
]
const TAGS = [
  { placement: { kind: 'client' }, label: 'Whole client' },
  { placement: { kind: 'site', siteId: 's1' }, label: 'Kent Ridge campus' },
  {
    placement: { kind: 'assessment', assessmentId: 'a1' },
    label: 'RPT-2026-0412 · Kent Ridge campus',
  },
]

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// What the gateway answers to an upload, a retag or a delete; tests set it.
type Change = (call: string, body: unknown) => Promise<Response> | void
// The gateway: the work list, the client, its documents and tags; changes recorded.
function gateway(documents: ClientDocument[] = DOCS, change: Change = () => undefined) {
  const calls: { call: string; body: unknown }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const body =
        init?.body instanceof FormData ? init.body : init?.body && JSON.parse(String(init.body))
      calls.push({ call: `${method} ${url}`, body })
      return change(`${method} ${url}`, body) ?? json(undefined, 204)
    }
    if (url === '/api/assessments') return json(WORK_LIST)
    if (url === '/api/clients/c1') return json({ ...PAGE, documents: documents.length })
    if (url === '/api/clients/c1/documents') return json(documents)
    if (url === '/api/clients/c1/document-tags') return json(TAGS)
    if (url === '/api/clients')
      return json([{ id: 'c1', name: 'NUS', sites: 1, division: 'Education' }])
    return json([])
  })
  return calls
}

async function openDocuments() {
  window.history.replaceState(null, '', '/clients/c1')
  render(<App />)
  await signIn()
  await screen.findByRole('heading', { name: 'NUS', level: 1 })
  fireEvent.click(await screen.findByRole('tab', { name: /Documents/ }))
}
const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement

describe('Client documents (CP-23)', () => {
  it('lists each document with its origin and tag, and opens the original in a new tab', async () => {
    gateway()
    await openDocuments()
    const row = await rowOf('Site plan.pdf')
    expect(row).toHaveTextContent('Uploaded by Alex Rowe')
    expect(within(row).getByRole('button', { name: /Tag of Site plan.pdf/ })).toHaveTextContent(
      'Kent Ridge campus',
    )
    expect(row).toHaveTextContent('5 Oct 2026')
    expect(row).toHaveTextContent('1.8 KB')
    const link = within(row).getByRole('link', { name: 'Open Site plan.pdf, opens in a new tab' })
    expect(link).toHaveAttribute('href', '/api/client-documents/d2/file')
    expect(link).toHaveAttribute('target', '_blank')
    expect(await rowOf('Engagement letter.pdf')).toHaveTextContent('From client documents')
    expect(screen.getByRole('tab', { name: 'Documents, 3' })).toBeInTheDocument()
    expect(screen.getByText('3 documents')).toBeInTheDocument()
  })

  it('finds documents by name and filters them by tag', async () => {
    gateway()
    await openDocuments()
    await rowOf('Site plan.pdf')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), {
      target: { value: 'letter' },
    })
    expect(screen.queryByText('Site plan.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('Engagement letter.pdf')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tag' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Whole client' }))
    expect(screen.queryByText('Site plan.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('Engagement letter.pdf')).toBeInTheDocument()
  })

  it('uploads files, shows the kept ones and says why the others were refused', async () => {
    const kept = doc('d9', 'Insurance schedule.pdf', 'Whole client', { kind: 'client' }, 'upload')
    const calls = gateway(DOCS, (call) =>
      call === 'POST /api/clients/c1/documents'
        ? json(
            {
              files: [
                { name: 'Insurance schedule.pdf', status: 'kept', document: kept },
                { name: 'notes.zip', status: 'refused', reason: "Can't read .zip files." },
              ],
            },
            201,
          )
        : undefined,
    )
    await openDocuments()
    await rowOf('Site plan.pdf')
    const files = [
      new File(['a'], 'Insurance schedule.pdf', { type: 'application/pdf' }),
      new File(['b'], 'notes.zip', { type: 'application/zip' }),
    ]
    fireEvent.change(screen.getByLabelText('Choose documents to upload'), { target: { files } })
    expect(await rowOf('Insurance schedule.pdf')).toHaveTextContent('Uploaded by Alex Rowe')
    const post = calls.find((c) => c.call === 'POST /api/clients/c1/documents')!
    expect((post.body as FormData).getAll('file')).toHaveLength(2)
    expect(await screen.findByText('1 document uploaded')).toBeInTheDocument()
    expect(await screen.findByText(/notes.zip/)).toBeInTheDocument()
    expect(screen.getByText("Can't read .zip files.")).toBeInTheDocument()
  })

  it('moves a document to another tag from its Tag pill and says so', async () => {
    const calls = gateway(DOCS, (call) =>
      call === 'PATCH /api/client-documents/d1'
        ? json(doc('d1', 'Engagement letter.pdf', 'Kent Ridge campus', SITE_PLACEMENT))
        : undefined,
    )
    await openDocuments()
    const row = await rowOf('Engagement letter.pdf')
    fireEvent.click(within(row).getByRole('button', { name: /Tag of Engagement letter.pdf/ }))
    const picker = await screen.findByRole('listbox', { name: 'Tag' })
    expect(within(picker).getByRole('option', { name: 'Whole client' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(within(picker).getByRole('option', { name: 'Kent Ridge campus' }))
    await waitFor(() =>
      expect(
        within(row).getByRole('button', { name: /Tag of Engagement letter.pdf/ }),
      ).toHaveTextContent('Kent Ridge campus'),
    )
    expect(calls).toContainEqual({
      call: 'PATCH /api/client-documents/d1',
      body: { placement: { kind: 'site', siteId: 's1' } },
    })
    expect(await screen.findByText('Tag changed to Kent Ridge campus')).toBeInTheDocument()
  })

  it('asks before deleting, then deletes, drops the row and says so', async () => {
    const calls = gateway()
    await openDocuments()
    const row = await rowOf('Site plan.pdf')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Site plan.pdf' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Site plan.pdf?' })
    // Cancel leaves it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls).toEqual([])
    expect(screen.getByText('Site plan.pdf')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Delete Site plan.pdf' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Site plan.pdf?' })).getByRole('button', {
        name: 'Delete',
      }),
    )
    await waitFor(() => expect(screen.queryByText('Site plan.pdf')).not.toBeInTheDocument())
    expect(calls).toEqual([{ call: 'DELETE /api/client-documents/d2', body: undefined }])
    expect(await screen.findByText('Site plan.pdf deleted')).toBeInTheDocument()
  })

  it('says when a client has no documents and still offers Add documents', async () => {
    gateway([])
    await openDocuments()
    expect(await screen.findByText('No documents yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add documents' })).toBeInTheDocument()
  })
})

const openClients = async () => {
  render(<App />)
  await signIn()
  fireEvent.click((await screen.findAllByRole('button', { name: 'Clients' }))[0])
  return screen.findByRole('row', { name: /NUS/ })
}

describe('Clients table (CP-23)', () => {
  it('shows division, sites, open assessments, jurisdictions, next survey with its site and a late report due', async () => {
    gateway()
    const row = await openClients()
    expect(screen.getByRole('heading', { name: 'Clients', level: 1 })).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(0, 6)).toEqual([
      'Client',
      'Sites',
      'Open',
      'Jurisdictions',
      'Next survey',
      'Next report due',
    ])
    await waitFor(() => expect(row).toHaveTextContent('Education'))
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('1')
    expect(cells[2]).toHaveTextContent('1')
    expect(cells[3]).toHaveTextContent('Singapore')
    expect(cells[4]).toHaveTextContent('12 Mar 2099')
    expect(cells[4]).toHaveTextContent('Kent Ridge campus')
    expect(cells[5]).toHaveTextContent('1 Jan 2020')
    expect(cells[5]).toHaveTextContent('days late')
  })

  it('counts clients and late reports in the footer, the late count filtering to them', async () => {
    gateway()
    await openClients()
    expect(screen.getByText('1 client')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 report late' }))
    expect(screen.getByRole('button', { name: 'Report due: Late' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /NUS/ })).toBeInTheDocument()
  })

  it('filters by jurisdiction and says when nothing matches', async () => {
    gateway()
    await openClients()
    fireEvent.click(screen.getByRole('button', { name: 'Jurisdiction' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Singapore' }))
    expect(screen.getByRole('row', { name: /NUS/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Jurisdiction: Singapore' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Any jurisdiction' }))
    fireEvent.click(screen.getByRole('button', { name: 'Report due' }))
    fireEvent.click(await screen.findByRole('option', { name: 'On track' }))
    expect(await screen.findByText('No clients match')).toBeInTheDocument()
  })

  it('opens the existing rename and remove dialogs from the row’s icons', async () => {
    gateway()
    const row = await openClients()
    fireEvent.click(within(row).getByRole('button', { name: 'Rename client NUS' }))
    expect(screen.getByRole('dialog', { name: 'Rename NUS' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Remove client NUS' }))
    expect(screen.getByRole('dialog', { name: /Remove NUS/ })).toBeInTheDocument()
  })

  it('offers New assessment with its ways to start in the toolbar', async () => {
    gateway()
    await openClients()
    expect(screen.getByRole('button', { name: 'New assessment' })).toBeInTheDocument()
  })
})

describe('Client page header and facts (CP-23)', () => {
  it('names the tabs Open work, Sites and Documents, each with its count', async () => {
    gateway()
    await openDocuments()
    expect(screen.getByRole('tab', { name: 'Open work, 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sites, 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Documents, 3' })).toBeInTheDocument()
  })

  it('puts Rename and Remove beside the name, with no division chip (it is in the facts)', async () => {
    gateway()
    await openDocuments()
    expect(screen.getByRole('button', { name: 'Rename client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove client' })).toBeInTheDocument()
    const title = screen.getByRole('heading', { name: 'NUS', level: 1 }).parentElement!
    expect(title).not.toHaveTextContent('Education')
  })

  it('lists the client’s facts in a side panel on Open work and Sites, not on Documents', async () => {
    gateway()
    window.history.replaceState(null, '', '/clients/c1')
    render(<App />)
    await signIn()
    await screen.findByRole('heading', { name: 'NUS', level: 1 })
    const facts = screen.getByLabelText('Client facts')
    for (const label of [
      'Division',
      'Jurisdictions',
      'Facility types',
      'First survey',
      'Next report due',
    ])
      expect(within(facts).getByText(label)).toBeInTheDocument()
    expect(within(facts).getByText('Education')).toBeInTheDocument()
    expect(within(facts).getByText('Singapore')).toBeInTheDocument()
    expect(within(facts).getByText('Office')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Documents/ }))
    expect(screen.queryByLabelText('Client facts')).not.toBeInTheDocument()
  })

  it('takes one whole character per word for the initials, skipping words without letters', () => {
    const { container } = render(<ClientAvatar name="🌿 Green Co" />)
    expect(container).toHaveTextContent(/^GC$/)
    cleanup()
    render(<ClientAvatar name="Émile 🌿Zest" />)
    expect(document.body).toHaveTextContent(/^É🌿$/)
  })
})

describe('clientFacts', () => {
  it('finds first, last, next survey and the next report due', () => {
    const v = (surveyDate: string, dueDate: string | null, done = false) => ({
      site: 'A',
      surveyDate,
      dueDate,
      done,
      archived: false,
    })
    const f = clientFacts(
      [v('2026-01-01', '2026-02-01', true), v('2026-12-01', '2026-12-15'), v('2027-01-01', null)],
      '2026-11-03',
    )
    expect(f.firstSurvey).toBe('2026-01-01')
    expect(f.lastSurvey).toBe('2027-01-01')
    expect(f.nextSurvey).toEqual({ date: '2026-12-01', site: 'A' })
    expect(f.nextDue).toEqual({ date: '2026-12-15', overdue: false })
  })
})
