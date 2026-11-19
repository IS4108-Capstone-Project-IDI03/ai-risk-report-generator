// IN-18: a standard entered clause by clause, in the Documents tab. A draft is
// listed with the documents so any admin can continue it, and published from its
// details. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
function mockGateway(
  documents: object[],
  onPublish: (id: string) => Promise<Response> = () => json(500, {}),
) {
  const published: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === '/api/knowledge-documents/ingested') return json(200, documents)
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
  return screen.getByRole('region', { name: `Details of ${title}` })
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
    expect(within(draft).queryByRole('link', { name: /view original/i })).not.toBeInTheDocument()
    expect(
      within(await row(UPLOADED.title)).getByRole('link', { name: /view original/i }),
    ).toBeInTheDocument()
  })

  it('is found by the Draft status, and is not Active', async () => {
    mockGateway([DRAFT, UPLOADED])
    await openKnowledgeBase()
    await row(DRAFT.title)

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'draft' } })
    expect(screen.queryByRole('button', { name: /^NFPA 20/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^NFPA 13/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } })
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
