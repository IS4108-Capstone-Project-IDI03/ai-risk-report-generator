// The Needs review reasons and the Review page (IN-07): what a row says, how
// the page walks through Confirm details and Decide, and what each decision
// sends. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { reviewIdForPath } from '../auth/access'

const base = {
  issuingBody: 'NFPA',
  fileName: 'x.pdf',
  size: 2048,
  status: 'complete',
  error: null,
  uploadedAt: '2026-09-29T03:00:00.000Z',
  history: [],
  unconfirmed: [],
  withdrawn: null,
  match: null,
  newerEdition: null,
  sourceType: 'nfpa_standard',
  jurisdiction: 'SG',
  facilityType: 'all',
  effectiveDate: '2022-01-01',
}
const STORED = { ...base, id: 'old', title: 'NFPA 13', edition: '2019', fileUrl: '/f/old' }
const match = (kind: string, extra: object = {}) => ({
  kind,
  document: { id: 'old', title: 'NFPA 13', edition: '2019', withdrawn: false },
  newMatched: 92,
  newTotal: 98,
  storedMatched: 92,
  storedTotal: 120,
  otherNeedsReview: false,
  ...extra,
})
const NEWER = {
  ...base,
  id: 'new',
  title: 'NFPA 13',
  edition: '2022',
  fileUrl: '/f/new',
  match: match('newer_edition'),
}

const passage = (id: string, text: string, page = 1) => ({
  id,
  text,
  pageStart: page,
  pageEnd: page,
})
// Three matching, one differing, then three matching passages.
const ROWS = [
  { stored: passage('s1', 'Same one'), new: passage('n1', 'Same one'), differs: false },
  { stored: passage('s2', 'Same two'), new: passage('n2', 'Same two'), differs: false },
  { stored: passage('s3', 'Same three'), new: passage('n3', 'Same three'), differs: false },
  { stored: passage('s4', 'Old wording'), new: passage('n4', 'New wording', 2), differs: true },
  { stored: passage('s5', 'Same five'), new: passage('n5', 'Same five'), differs: false },
  { stored: null, new: passage('n6', 'Added passage'), differs: true },
]

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

type Calls = { decisions: string[]; puts: unknown[]; urls: string[]; comparisons: number }
// Answers the list with `list`; the comparison like the gateway does (404 for
// a document not in `list`, 409 for one with no match, else the pair with
// `rows`); a decision with `onDecision`; a details save with `onPut`.
// `failComparison` lists the comparison calls (1 = first) that answer 500.
function mockGateway(
  list: object[],
  opts: {
    rows?: object[]
    onDecision?: (choice: string) => Promise<Response>
    onPut?: () => Promise<Response>
    failComparison?: number[]
  } = {},
) {
  const calls: Calls = { decisions: [], puts: [], urls: [], comparisons: 0 }
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.urls.push(url)
    if (url === '/api/knowledge-documents/ingested' || url === '/api/knowledge-documents')
      return json(200, list)
    if (url.endsWith('/comparison')) {
      calls.comparisons += 1
      if (opts.failComparison?.includes(calls.comparisons)) return json(500, { error: 'Boom.' })
      const id = url.split('/')[3]
      const found = list.find((d) => (d as { id: string }).id === id) as
        { match: unknown } | undefined
      if (!found) return json(404, { error: 'Unknown document.' })
      if (!found.match) return json(409, { error: 'No match.' })
      return json(200, { document: found, matched: STORED, rows: opts.rows ?? ROWS })
    }
    if (url.endsWith('/decision')) {
      const { choice } = JSON.parse(String(init?.body))
      calls.decisions.push(choice)
      return (opts.onDecision ?? (() => json(200, { document: NEWER })))(choice)
    }
    if (init?.method === 'PUT') {
      calls.puts.push(JSON.parse(String(init.body)))
      return (opts.onPut ?? (() => json(500, {})))()
    }
    if (url.startsWith('/api/knowledge-documents')) return json(200, [])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
  return calls
}

async function openList() {
  render(<App />)
  await signIn('knowledge_admin')
  fireEvent.click(screen.getAllByRole('button', { name: 'Knowledge base' })[0])
}
// Opens the Review page by its URL, as a link or a reload would.
async function openReviewPage(id = 'new') {
  window.history.replaceState(null, '', `/admin/knowledge-base/review/${id}`)
  render(<App />)
  await signIn('knowledge_admin')
}
const ALL = [
  'Keep both',
  'Delete this document',
  'Replace stored edition',
  'Keep as older edition',
  'Delete stored document',
]
const choice = (name: RegExp) => screen.findByRole('radio', { name })

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

describe('Needs review reasons (IN-07)', () => {
  it('shows why a matched document needs review, counts it, and filters it out of Active', async () => {
    mockGateway([STORED, NEWER])
    await openList()

    await screen.findByRole('button', { name: 'Needs review: NFPA 13' })
    const row = screen
      .getAllByRole('row')
      .find((r) => within(r).queryByRole('button', { name: 'Needs review: NFPA 13' }))!
    expect(
      within(row).getByText('Possible newer edition of NFPA 13 (2019 edition)'),
    ).toBeInTheDocument()
    // The Needs review badge is itself the Review button; there is no second one.
    expect(within(row).getByRole('button', { name: 'Needs review: NFPA 13' })).toHaveTextContent(
      'Needs review',
    )
    expect(within(row).queryByText('Review', { exact: true })).not.toBeInTheDocument()
    expect(within(row).queryByText('Active')).not.toBeInTheDocument()
    expect(
      await screen.findByRole('tab', { name: 'Documents, 1 needs review' }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } })
    expect(screen.queryByRole('button', { name: 'Needs review: NFPA 13' })).not.toBeInTheDocument()
  })

  it('names both reasons when a document has Unconfirmed details and a match', async () => {
    mockGateway([{ ...NEWER, unconfirmed: ['facilityType'], facilityType: null }])
    await openList()
    // The banner repeats the match; the row names both causes.
    const review = await screen.findByRole('button', { name: 'Needs review: NFPA 13' })
    expect(
      within(review.closest('tr')!).getByText(
        'Possible newer edition of NFPA 13 (2019 edition) · Unconfirmed details',
      ),
    ).toBeInTheDocument()
  })

  it('opens the Review page from the row and the banner, and Back keeps the filters', async () => {
    mockGateway([STORED, NEWER])
    await openList()
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'needs_review' } })

    fireEvent.click(screen.getByRole('button', { name: 'Needs review: NFPA 13' }))
    expect(window.location.pathname).toBe('/admin/knowledge-base/review/new')
    expect(await screen.findByRole('heading', { level: 2, name: 'NFPA 13' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All documents' }))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    expect(await screen.findByLabelText('Status')).toHaveValue('needs_review')
  })

  it("shows a withdrawn edition the family's newest edition", async () => {
    mockGateway([
      {
        ...STORED,
        withdrawn: { at: '2026-10-01T03:00:00.000Z', by: { id: 'u', name: 'Sana Patel' } },
        newerEdition: { id: 'new', title: 'NFPA 13', edition: '2026' },
      },
    ])
    await openList()
    expect(await screen.findByText('Replaced by the 2026 edition')).toBeInTheDocument()
  })
})

describe('Review page (IN-07)', () => {
  it('focuses the heading and shows only the decision panel for a match with no Unconfirmed details', async () => {
    mockGateway([STORED, NEWER])
    await openReviewPage()

    const heading = await screen.findByRole('heading', { level: 2, name: 'NFPA 13' })
    expect(heading).toHaveFocus()
    // No step strip and no Confirm details section: nothing was Unconfirmed.
    expect(screen.queryByRole('list', { name: 'Review steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Confirm details' })).not.toBeInTheDocument()
    const panel = screen.getByRole('complementary', { name: 'Decision' })
    expect(
      within(panel).getByRole('heading', {
        level: 3,
        name: 'Possible newer edition of NFPA 13 (2019 edition)',
      }),
    ).toBeInTheDocument()
    const counts = within(panel).getByLabelText('Passages that match')
    expect(within(counts).getByText('92 of 98')).toBeInTheDocument()
    expect(within(counts).getByText('92 of 120')).toBeInTheDocument()
  })

  it('tags the usual choice and starts with nothing chosen', async () => {
    mockGateway([STORED, NEWER])
    await openReviewPage()

    const replace = await choice(/^Replace stored edition/)
    expect(replace.closest('label')).toHaveTextContent('Usual choice')
    expect(screen.getAllByText('Usual choice')).toHaveLength(1)
    screen.getAllByRole('radio').forEach((r) => expect(r).not.toBeChecked())
    expect(screen.getByRole('button', { name: 'Choose what happens' })).toBeDisabled()
  })

  it('keeps Decide locked until the details are saved, then opens the comparison', async () => {
    const unconfirmed = { ...NEWER, unconfirmed: ['facilityType'], facilityType: null }
    const saved = { ...NEWER, facilityType: 'all' }
    const calls = mockGateway([STORED, unconfirmed], { onPut: () => json(200, saved) })
    await openReviewPage()

    expect(await screen.findByText(/Save the details first/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirm details' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Facility type/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(calls.puts).toHaveLength(1)
    expect(await choice(/^Keep both/)).toBeInTheDocument()
    // The summary has an Edit details button to change them again.
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument()
  })

  it('keeps the passages after saving the details again with the same match', async () => {
    const unconfirmed = { ...NEWER, unconfirmed: ['facilityType'], facilityType: null }
    const saved = { ...NEWER, facilityType: 'all' }
    mockGateway([STORED, unconfirmed], { onPut: () => json(200, saved) })
    await openReviewPage()

    fireEvent.change(await screen.findByLabelText(/^Facility type/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('New wording')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(screen.getByText('New wording')).toBeInTheDocument()
    expect(screen.queryByText('Loading the passages…')).not.toBeInTheDocument()
  })

  it('returns to the list with a toast when saving details leaves nothing to decide', async () => {
    const unconfirmed = { ...STORED, id: 'solo', unconfirmed: ['facilityType'], facilityType: null }
    mockGateway([unconfirmed], {
      onPut: () => json(200, { ...unconfirmed, unconfirmed: [], facilityType: 'all' }),
    })
    await openReviewPage('solo')

    await screen.findByLabelText(/^Facility type/)
    fireEvent.change(screen.getByLabelText(/^Facility type/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(
      await screen.findByText('Details saved. NFPA 13 (2019 edition) is now active.'),
    ).toBeInTheDocument()
    expect(window.location.pathname).not.toMatch(/\/review\//)
    expect(screen.queryByText(/no longer needs review/)).not.toBeInTheDocument()
  })

  it('says Keep both keeps a copy of a withdrawn edition withdrawn', async () => {
    const old = { id: 'old', title: 'NFPA 13', edition: '2019', withdrawn: true }
    const copy = { ...NEWER, edition: '2019', match: match('possible_copy', { document: old }) }
    mockGateway([STORED, copy])
    await openReviewPage()

    const panel = await screen.findByRole('complementary', { name: 'Decision' })
    expect(
      await within(panel).findByText('Possible copy of NFPA 13 (2019 edition, withdrawn)'),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(
        'This document is kept as withdrawn, like NFPA 13 (2019 edition), so reports never use it.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(await choice(/^Keep both/))
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))
    expect(
      await screen.findByText(
        'Kept both. NFPA 13 (2019 edition) is withdrawn, like NFPA 13 (2019 edition).',
      ),
    ).toBeInTheDocument()
  })

  it('offers the choices that fit each kind of match', async () => {
    const labels = async (m: object) => {
      mockGateway([STORED, { ...NEWER, match: m }])
      await openReviewPage()
      await choice(/^Keep both/)
      // Each radio's label starts with the choice's name.
      const names = screen
        .getAllByRole('radio')
        .map((r) => ALL.find((l) => r.closest('label')!.textContent!.startsWith(l)))
      cleanup()
      return names
    }

    expect(await labels(match('newer_edition'))).toEqual([
      'Keep both',
      'Replace stored edition',
      'Delete this document',
    ])
    expect(await labels(match('earlier_edition'))).toEqual([
      'Keep both',
      'Keep as older edition',
      'Delete this document',
    ])
    expect(await labels(match('possible_copy'))).toEqual(['Keep both', 'Delete this document'])
    expect(await labels(match('possible_copy', { otherNeedsReview: true }))).toEqual([
      'Keep both',
      'Delete this document',
      'Delete stored document',
    ])
    // Both documents waiting for a decision still offer the kind's own choice.
    expect(await labels(match('newer_edition', { otherNeedsReview: true }))).toEqual([
      'Keep both',
      'Replace stored edition',
      'Delete this document',
      'Delete stored document',
    ])
  })

  it('says plainly when no passage differs', async () => {
    const same = passage('s1', 'Same one')
    mockGateway([STORED, NEWER], { rows: [{ new: same, stored: same, differs: false }] })
    await openReviewPage()

    expect(await screen.findByText('Every passage matches. Nothing differs.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 matching passage' })).toBeInTheDocument()
  })

  it('shows the differing passages, folds matching runs, and expands a fold on click', async () => {
    mockGateway([STORED, NEWER])
    await openReviewPage()

    // Differences only is on: the matching runs are folds, the differing rows show.
    expect(await screen.findByText('New wording')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Differences only' })).toBeChecked()
    expect(screen.queryByText('Same one')).not.toBeInTheDocument()
    const fold = screen.getByRole('button', { name: '3 matching passages' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '1 matching passage' })).toBeInTheDocument()

    fireEvent.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('Same one').length).toBeGreaterThan(0)
    // A passage with no pair says which side lacks it.
    expect(screen.getByText('Not in the stored document')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Differences only' }))
    expect(screen.getAllByText('Same five').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /matching passage/ })).not.toBeInTheDocument()
  })

  it('always shows the passages, with only the fold and Differences only to narrow them', async () => {
    mockGateway([STORED, NEWER])
    await openReviewPage()

    await screen.findByText('New wording')
    expect(screen.queryByRole('button', { name: /^(Hide|Show) passages$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Differences only' })).toBeInTheDocument()
  })

  it('updates the Documents tab count after deciding from Add documents', async () => {
    const list: object[] = [STORED, { ...NEWER, status: 'complete' }]
    mockGateway(list, {
      onDecision: () => {
        list[1] = { ...NEWER, status: 'complete', match: null }
        return json(200, { document: list[1] })
      },
    })
    await openList()
    expect(
      await screen.findByRole('tab', { name: 'Documents, 1 needs review' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Add documents/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Needs review: NFPA 13' }))
    fireEvent.click(await choice(/^Keep both/))
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))

    expect(await screen.findByRole('tab', { name: 'Documents' })).toBeInTheDocument()
  })

  it('keeps the outcome toast when the Review page was opened from the list', async () => {
    mockGateway([STORED, NEWER])
    await openList()

    fireEvent.click(await screen.findByRole('button', { name: 'Needs review: NFPA 13' }))
    fireEvent.click(await choice(/^Keep both/))
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))

    // Going back to the list fires popstate, which must not wipe the toast.
    expect(await screen.findByText(/^Kept both\./)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText(/^Kept both\./)).toBeInTheDocument()
  })

  it('applies Replace stored edition with a verb button, then returns to the list with the outcome', async () => {
    const calls = mockGateway([STORED, NEWER])
    await openReviewPage()

    const apply = await screen.findByRole('button', { name: 'Choose what happens' })
    expect(apply).toBeDisabled()
    fireEvent.click(await choice(/^Replace stored edition/))
    expect(screen.getByRole('button', { name: 'Replace stored edition' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Replace stored edition' }))

    await waitFor(() => expect(calls.decisions).toEqual(['supersede']))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    expect(await screen.findByText(/is now active\. .* is withdrawn/)).toBeInTheDocument()
  })

  it('shows the server reason when a decision is refused', async () => {
    mockGateway([STORED, NEWER], {
      onDecision: () =>
        json(409, { error: 'The matched document is no longer in the knowledge base.' }),
    })
    await openReviewPage()

    fireEvent.click(await choice(/^Keep both/))
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The matched document is no longer in the knowledge base.')
    expect(window.location.pathname).toContain('/review/')
  })

  it('asks before discarding, sends nothing on Cancel, and shows a refusal inside the dialog', async () => {
    const calls = mockGateway([STORED, NEWER], {
      onDecision: () => json(409, { error: 'Details are still Unconfirmed.' }),
    })
    await openReviewPage()

    fireEvent.click(await choice(/^Delete this document/))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this document' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete NFPA 13?' })
    expect(calls.decisions).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls.decisions).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Delete this document' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete NFPA 13?' })).getByRole('button', {
        name: 'Delete this document',
      }),
    )
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Details are still Unconfirmed.',
    )
    expect(calls.decisions).toEqual(['discard_new'])
  })

  it('reads the comparison once for a matched document with saved details', async () => {
    const calls = mockGateway([STORED, NEWER])
    await openReviewPage()
    await choice(/^Keep both/)
    expect(calls.comparisons).toBe(1)
  })

  it('retries only the comparison, keeping the Confirm details step', async () => {
    const unconfirmed = { ...NEWER, unconfirmed: ['facilityType'], facilityType: null }
    const saved = { ...NEWER, facilityType: 'all' }
    // Call 1 is the page load; call 2, after the save, fails.
    mockGateway([STORED, unconfirmed], {
      onPut: () => json(200, saved),
      failComparison: [2],
    })
    await openReviewPage()
    await screen.findByLabelText(/^Facility type/)
    fireEvent.change(screen.getByLabelText(/^Facility type/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await screen.findByText('Could not load the passages')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await choice(/^Keep both/)).toBeInTheDocument()
    expect(screen.getByText('Saved.')).toBeInTheDocument()
  })

  it('says when the document is no longer in the knowledge base', async () => {
    mockGateway([STORED])
    await openReviewPage('gone')
    expect(
      await screen.findByText('This document is no longer in the knowledge base'),
    ).toBeInTheDocument()
  })
})

describe('reviewIdForPath (IN-07)', () => {
  it('reads the id, and returns null for other paths or a malformed escape', () => {
    expect(reviewIdForPath('/admin/knowledge-base/review/abc%20d/')).toBe('abc d')
    expect(reviewIdForPath('/admin/knowledge-base/review/')).toBeNull()
    expect(reviewIdForPath('/admin/knowledge-base/review/a/b')).toBeNull()
    expect(reviewIdForPath('/admin/knowledge-base')).toBeNull()
    expect(reviewIdForPath('/admin/knowledge-base/review/%E0')).toBeNull()
  })
})
