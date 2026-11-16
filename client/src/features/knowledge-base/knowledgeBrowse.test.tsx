// IN-17: a risk engineer browses the knowledge base read-only. They open the
// Knowledge base screen and see the Documents tab, but nothing that changes a
// document. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

// jsdom has no <dialog> methods; the Passages dialog needs them.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

const base = {
  issuingBody: 'NFPA',
  standardNumber: '13',
  fileName: 'nfpa-13.pdf',
  size: 2048,
  sha256: 'abc',
  status: 'complete',
  error: null,
  uploadedAt: '2026-09-29T03:00:00.000Z',
  history: [],
  unconfirmed: [],
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
  facilityType: 'all',
}
const NFPA = {
  ...base,
  id: 'nfpa',
  title: 'NFPA 13 sprinkler standard',
  edition: '2022',
  effectiveDate: '2022-01-01',
  fileUrl: '/api/knowledge-documents/nfpa/file',
}
// Waits for a decision (IN-07): an admin would see a Review link.
const UNREVIEWED = {
  ...base,
  id: 'nfpa-2025',
  title: 'NFPA 13 sprinkler standard 2025',
  edition: '2025',
  effectiveDate: '2025-01-01',
  fileUrl: '/api/knowledge-documents/nfpa-2025/file',
  unconfirmed: ['facility_type'],
  facilityType: null,
}

const FM = {
  ...base,
  id: 'fm',
  title: 'FM 2-0 Installation guidelines',
  issuingBody: 'FM Global',
  standardNumber: '2-0',
  edition: '2024',
  sourceType: 'fm_standard',
  jurisdiction: 'all',
  effectiveDate: '2024-01-01',
  fileUrl: '/api/knowledge-documents/fm/file',
}

const LONG_TEXT =
  'Sprinklers shall be installed throughout the premises, including concealed spaces ' +
  'above ceilings, except where this standard permits their omission.'
const PASSAGES = [
  {
    id: 'nfpa:0',
    text: LONG_TEXT,
    headings: ['Chapter 8 Installation', '8.1 Basic requirements'],
    section: 'Not applicable',
    pageStart: 12,
    pageEnd: 13,
    status: 'active',
  },
  {
    id: 'nfpa:1',
    text: 'Ceiling pockets shall be protected.',
    headings: [],
    section: 'Not applicable',
    pageStart: 14,
    pageEnd: 14,
    status: 'active',
  },
]

const requested: string[] = []
// Answers the list with `documents` and a document's passages with `passages`
// (a status number makes that call fail).
function mockGateway(documents: object[], passages: object[] | number = PASSAGES) {
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url)
    if (url.endsWith('/passages')) {
      return Promise.resolve(
        typeof passages === 'number'
          ? Response.json({ error: 'The passages could not be loaded.' }, { status: passages })
          : Response.json({ passages }),
      )
    }
    const answer = url === '/api/knowledge-documents/ingested' ? documents : []
    return Promise.resolve(Response.json(answer))
  })
}

// Opens a document's details, then its passages.
async function openPassages(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))
  const details = screen.getByRole('region', { name: `Details of ${title}` })
  fireEvent.click(within(details).getByRole('button', { name: 'View passages' }))
  return screen.getByRole('dialog', { name: 'Passages' })
}

afterEach(() => {
  cleanup()
  requested.length = 0
  vi.unstubAllGlobals()
})

async function openAsEngineer() {
  render(<App />)
  await signIn('risk_engineer')
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}

describe('Knowledge base for a risk engineer (IN-17)', () => {
  it('opens on the Documents tab only, without the admin-only Requests list', async () => {
    mockGateway([NFPA])

    await openAsEngineer()

    expect(await screen.findByRole('button', { name: /^NFPA 13 sprinkler standard/ })).toBeVisible()
    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByRole('tab', { name: /Documents/ })).toBeInTheDocument()
    expect(within(tabs).queryByRole('tab', { name: /Add documents/ })).not.toBeInTheDocument()
    expect(within(tabs).queryByRole('tab', { name: /Requests/ })).not.toBeInTheDocument()
    expect(requested).not.toContain('/api/knowledge-gaps')
  })

  it("shows a document's details with nothing that changes it", async () => {
    mockGateway([NFPA])
    await openAsEngineer()

    fireEvent.click(await screen.findByRole('button', { name: /^NFPA 13 sprinkler standard/ }))

    const details = screen.getByRole('region', { name: 'Details of NFPA 13 sprinkler standard' })
    expect(within(details).getByText('2022')).toBeVisible()
    for (const action of ['Edit details', 'Withdraw', 'Delete']) {
      expect(within(details).queryByRole('button', { name: action })).not.toBeInTheDocument()
    }
  })

  it('marks a document that needs review without offering the review', async () => {
    mockGateway([UNREVIEWED])
    await openAsEngineer()

    expect(await screen.findByText('Needs review')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /^Needs review: NFPA 13 sprinkler standard 2025/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Documents to review' })).not.toBeInTheDocument()
  })

  it('filters the list by source type', async () => {
    mockGateway([FM, NFPA])
    await openAsEngineer()
    expect(await screen.findByRole('button', { name: /^FM 2-0 Installation/ })).toBeVisible()

    fireEvent.change(screen.getByLabelText('Source type'), { target: { value: 'nfpa_standard' } })

    expect(screen.getByRole('button', { name: /^NFPA 13 sprinkler standard/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^FM 2-0 Installation/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Showing 1 of 2 documents')
  })

  it('shows the list, not the Review page, when an engineer opens a Review link', async () => {
    mockGateway([UNREVIEWED])
    window.history.replaceState(null, '', '/admin/knowledge-base/review/nfpa-2025')
    render(<App />)
    await signIn('risk_engineer')

    expect(await screen.findByRole('heading', { name: 'All documents' })).toBeVisible()
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(requested.some((url) => url.endsWith('/comparison'))).toBe(false)
  })
})

describe("A document's passages (IN-17)", () => {
  it('lists them in reading order with their heading trail and pages', async () => {
    mockGateway([NFPA])
    await openAsEngineer()

    const dialog = await openPassages('NFPA 13 sprinkler standard')

    const items = await within(dialog).findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Chapter 8 Installation › 8.1 Basic requirements')
    expect(items[0]).toHaveTextContent('Pages 12–13')
    expect(items[1]).toHaveTextContent('Page 14')
    expect(requested).toContain('/api/knowledge-documents/nfpa/passages')
  })

  it('shows a passage in full when it is opened', async () => {
    mockGateway([NFPA])
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')

    const first = await within(dialog).findByRole('button', { name: /^Chapter 8 Installation/ })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(first)

    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText(LONG_TEXT)).toBeVisible()
  })

  it('says so when a document has no passages', async () => {
    mockGateway([NFPA], [])
    await openAsEngineer()

    const dialog = await openPassages('NFPA 13 sprinkler standard')

    expect(await within(dialog).findByText('No passages in search')).toBeVisible()
  })

  it('explains a failed load and tries again', async () => {
    mockGateway([NFPA], 503)
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')

    expect(await within(dialog).findByText('Passages not loaded')).toBeVisible()
    mockGateway([NFPA])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }))

    expect(await within(dialog).findAllByRole('listitem')).toHaveLength(2)
  })
})
