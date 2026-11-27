// IN-18: a standard entered clause by clause, in the Documents tab. A draft is
// listed with the documents so any admin can continue it, and published from its
// details. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { choose } from './filterTestHelpers'
import App from '../../App'
import { signIn } from '../../test/session'
import type { KnowledgeDocument } from './api'
import { choicesFor, outcomeMessage } from './decisions'

const STANDARD = {
  issuingBody: 'NFPA',
  standardNumber: '13',
  sourceType: 'nfpa_standard',
  jurisdiction: 'all',
  facilityType: 'all',
  status: 'complete',
  error: null,
  uploadedAt: '2026-11-19T03:00:00.000Z',
  history: [],
  unconfirmed: [],
  withdrawn: null,
  handled: null,
  match: null,
  newerEdition: null,
  reinstateBlockedBy: null,
}
const DRAFT = {
  ...STANDARD,
  id: 'draft',
  title: 'NFPA 13 Installation of Sprinkler Systems',
  edition: '2025',
  effectiveDate: '2025-01-01',
  entryMethod: 'manual',
  status: 'draft',
  fileName: null,
  fileUrl: null,
  size: null,
}
const UPLOADED = {
  ...STANDARD,
  id: 'pdf',
  title: 'NFPA 20 Fire Pumps',
  standardNumber: '20',
  edition: '2022',
  effectiveDate: '2022-01-01',
  entryMethod: 'upload',
  fileName: 'nfpa-20.pdf',
  fileUrl: '/api/knowledge-documents/pdf/file',
  size: 2048,
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// The Documents list answers `documents`; Publish answers `onPublish`. Returns each publish's id.
// Every URL the screens asked for, to check what a manual document never fetches.
const requested: string[] = []
function mockGateway(
  documents: object[],
  onPublish: (id: string) => Promise<Response> = () => json(500, {}),
  // What a document's Passages view lists (IN-17).
  listing: object = {
    total: 0,
    passages: [],
    outline: { by: 'section', chapters: [], sections: [] },
  },
) {
  const published: string[] = []
  requested.length = 0
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requested.push(url)
    if (url === '/api/knowledge-documents/ingested') return json(200, documents)
    if (/^\/api\/knowledge-documents\/[^/]+\/passages/.test(url)) return json(200, listing)
    const publish = url.match(/^\/api\/knowledge-documents\/([^/]+)\/publish$/)
    if (publish && init?.method === 'POST') {
      published.push(publish[1])
      return onPublish(publish[1])
    }
    if (url.startsWith('/api/knowledge-documents')) return json(200, [])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  return published
}

async function openKnowledgeBase(role: 'knowledge_admin' | 'risk_engineer' = 'knowledge_admin') {
  render(<App />)
  await signIn(role)
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}
const row = async (title: string) =>
  (await screen.findByRole('button', { name: new RegExp(`^${title}`) })).closest('tr')!
async function open(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))
  return screen.getByRole('dialog', { name: title })
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

describe('a manual draft in the Documents list (IN-18)', () => {
  it('is listed with the documents as Draft, with no original to view', async () => {
    mockGateway([DRAFT, UPLOADED])
    await openKnowledgeBase()

    const draft = await row(DRAFT.title)

    expect(within(draft).getByText('Draft')).toBeInTheDocument()
    // A person is typing it in: no AI sparkles, the word alone.
    expect(within(draft).getByText('Draft').querySelector('[role="presentation"]')).toBeNull()
    expect(within(draft).queryByRole('link', { name: /view original/i })).not.toBeInTheDocument()
    expect(
      within(await row(UPLOADED.title)).getByRole('link', { name: /view original/i }),
    ).toBeInTheDocument()
  })

  it('is found by the Draft status, and is not Active', async () => {
    mockGateway([DRAFT, UPLOADED])
    await openKnowledgeBase()
    await row(DRAFT.title)

    choose('Status', 'Draft')
    expect(screen.queryByRole('button', { name: /^NFPA 20/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^NFPA 13/ })).toBeInTheDocument()

    choose('Status', 'Active')
    expect(screen.queryByRole('button', { name: /^NFPA 13/ })).not.toBeInTheDocument()
  })

  it('offers Publish and Delete draft, and none of a finished document’s actions', async () => {
    mockGateway([DRAFT])
    await openKnowledgeBase()

    const details = await open(DRAFT.title)

    expect(within(details).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Delete draft' })).toBeInTheDocument()
    for (const name of ['Edit details', 'Edit history', 'View passages', 'Withdraw']) {
      expect(within(details).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(details).toHaveTextContent(/Started 19 Nov/)
  })

  it('publishes it, shows it as Active, and says so', async () => {
    const published = mockGateway([DRAFT], (id) => json(200, { ...DRAFT, id, status: 'complete' }))
    await openKnowledgeBase()
    const details = await open(DRAFT.title)

    fireEvent.click(within(details).getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText(`${DRAFT.title} published.`)).toBeInTheDocument()
    expect(within(await row(DRAFT.title)).getByText('Active')).toBeInTheDocument()
    expect(published).toEqual(['draft'])
  })

  it('says why it can’t be published yet, and leaves it a draft', async () => {
    const reason =
      '1 clause failed to embed and 2 clauses are left to check. Finish them before publishing.'
    mockGateway([DRAFT], () => json(409, { error: reason, unindexed: 1, unchecked: 2 }))
    await openKnowledgeBase()
    const details = await open(DRAFT.title)

    fireEvent.click(within(details).getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(within(await row(DRAFT.title)).getByText('Draft')).toBeInTheDocument()
  })

  it('shows a risk engineer the draft, but no way to change it', async () => {
    mockGateway([DRAFT])
    await openKnowledgeBase('risk_engineer')

    const details = await open(DRAFT.title)

    expect(within(details).queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'Delete draft' })).not.toBeInTheDocument()
  })
})

describe('the PDF of a manually entered edition (IN-18)', () => {
  it('says which manual entry it matches', async () => {
    mockGateway([
      {
        ...UPLOADED,
        match: {
          kind: 'replaces_manual',
          document: { id: 'draft', title: DRAFT.title, edition: '2025', withdrawn: false },
          newMatched: 0,
          newTotal: 40,
          storedMatched: 0,
          storedTotal: 3,
          otherNeedsReview: false,
        },
      },
    ])
    await openKnowledgeBase()

    expect(await row(UPLOADED.title)).toHaveTextContent(
      `Same edition as the manual entry ${DRAFT.title} (2025 edition)`,
    )
  })
})

describe('the Review page’s choices for a manual entry’s match (IN-18)', () => {
  const match = {
    kind: 'replaces_manual',
    document: { id: 'draft', title: 'NFPA 13 (typed in)', edition: '2025', withdrawn: false },
    newMatched: 0,
    newTotal: 40,
    storedMatched: 0,
    storedTotal: 3,
    otherNeedsReview: false,
  }
  const pdf = { ...UPLOADED, title: 'NFPA 13', match } as unknown as KnowledgeDocument

  it('offers Replace manual entry as the usual choice, and never Replace stored edition', () => {
    const choices = choicesFor(pdf)

    expect(choices.map((c) => c.label)).toEqual([
      'Keep both',
      'Replace manual entry',
      'Delete this document',
    ])
    expect(choices.find((c) => c.usual)?.label).toBe('Replace manual entry')
    expect(choices[1].consequence).toBe(
      'This document becomes active. The manual entry NFPA 13 (typed in) (2025 edition) is withdrawn and kept, with its clauses.',
    )
  })

  it('says the manual entry is the one withdrawn when it is the one under review', () => {
    const manual = { ...pdf, entryMethod: 'manual' } as KnowledgeDocument

    expect(choicesFor(manual)[1].consequence).toMatch(/This manual entry is withdrawn/)
    expect(outcomeMessage(manual, 'replace_manual')).toMatch(/replaces this manual entry/)
  })
})

// T17: telling manual entries apart in the Documents list, and their passages.
describe('manual entries in the IN-17 browser (IN-18)', () => {
  it('filters by how a document was entered, and marks a manual entry', async () => {
    mockGateway([DRAFT, UPLOADED])
    await openKnowledgeBase()

    expect(within(await row(DRAFT.title)).getByText('Manual entry')).toBeInTheDocument()
    expect(within(await row(UPLOADED.title)).queryByText('Manual entry')).not.toBeInTheDocument()

    choose('Entry', 'Manual entry')
    expect(screen.queryByRole('button', { name: /^NFPA 20/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^NFPA 13/ })).toBeInTheDocument()

    choose('Entry', 'Uploaded')
    expect(screen.queryByRole('button', { name: /^NFPA 13/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^NFPA 20/ })).toBeInTheDocument()
  })

  it('shows a manual passage’s screenshot above its text, with no page and no file fetched', async () => {
    const PUBLISHED = { ...DRAFT, id: 'manual', status: 'complete' }
    const shot = 'knowledge/manual/sections/0b7c7c3e-6d1b-4a6e-9a51-6a0f8c1e2f3a.png'
    mockGateway([PUBLISHED], undefined, {
      total: 1,
      passages: [
        {
          id: 'manual:1',
          position: 1,
          text: 'Pipe size: 25 mm; Max spacing: 3.7 m',
          headings: ['Chapter 8 Installation', '8.6 Hangers'],
          section: 'Not applicable',
          pageStart: null,
          pageEnd: null,
          status: 'active',
          kind: 'table',
          generated: false,
          images: [shot],
        },
      ],
      outline: {
        by: 'clause',
        chapters: [{ name: '8', count: 1, title: 'Installation' }],
        sections: [],
      },
    })
    await openKnowledgeBase('risk_engineer')
    const details = await open(PUBLISHED.title)
    fireEvent.click(within(details).getByRole('button', { name: 'View passages' }))
    const dialog = await screen.findByRole('dialog', { name: 'Passages' })

    const passage = (await within(dialog).findByRole('button', { name: /8\.6 Hangers/ })).closest(
      'tr',
    )!
    expect(within(passage).getByText('—')).toBeInTheDocument()
    fireEvent.click(within(passage).getByRole('button', { name: /8\.6 Hangers/ }))

    const image = await within(dialog).findByRole('img', { name: 'Table' })
    expect(image).toHaveAttribute(
      'src',
      '/api/knowledge-documents/manual/sections/screenshots/0b7c7c3e-6d1b-4a6e-9a51-6a0f8c1e2f3a.png',
    )
    // Its text folds behind the screenshot, closed.
    const fold = dialog.querySelector('details.src-extracted') as HTMLDetailsElement
    expect(fold).toHaveTextContent('Pipe size: 25 mm')
    expect(fold.open).toBe(false)
    expect(requested.some((u) => u.includes('/api/chat/passages/'))).toBe(false)
    expect(requested.some((u) => u.endsWith('/file'))).toBe(false)
  })
})
