// IN-17: a risk engineer browses the knowledge base read-only. They open the
// Knowledge base screen and see the Documents tab, but nothing that changes a
// document. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { choose } from './filterTestHelpers'
import App from '../../App'
import { signIn } from '../../test/session'

// jsdom can't run pdf.js: the region of the original page is a plain image standing in for it,
// shown only when the passage records one (sources/CitedRegion.tsx does the real drawing).
vi.mock('../sources/CitedRegion', () => ({
  CitedRegion: ({ region }: { region: { kind: string } | null | undefined }) =>
    region ? <img alt={`${region.kind} on the original page`} /> : null,
}))

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
// One passage as the gateway lists it; `over` changes any field.
const passage = (n: number, over: object = {}) => ({
  id: `nfpa:${n}`,
  position: n + 1,
  text: `Passage ${n + 1} text.`,
  headings: ['25 NFPA', `8.${n + 1} Requirement ${n + 1}`],
  section: 'Not applicable',
  pageStart: 12 + n,
  pageEnd: 12 + n,
  status: 'active',
  kind: 'text',
  generated: false,
  ...over,
})
const FIRST = passage(0, {
  text: LONG_TEXT,
  headings: ['25 NFPA', '8.1 Basic requirements'],
  pageEnd: 13,
})
const TABLE = passage(1, { headings: ['8.2 Spacing'], kind: 'table', pageStart: 30, pageEnd: 30 })
const PICTURE = passage(2, {
  headings: [],
  kind: 'picture',
  generated: true,
  pageStart: null,
  pageEnd: null,
})
const OUTLINE = {
  by: 'clause',
  chapters: [
    { name: '', count: 4, title: null },
    { name: '8', count: 40, title: 'Installation' },
    { name: 'A', count: 16, title: 'Explanatory material' },
  ],
  sections: [],
}
// The listing the stub answers by default: these three of 60 passages.
const LISTING = { total: 60, passages: [FIRST, TABLE, PICTURE], outline: OUTLINE }
type Listing = { total: number; passages: object[]; outline: object }
// 60 passages, answered a page at a time as the gateway would.
const sixty = (query: URLSearchParams): Listing => {
  const offset = Number(query.get('offset'))
  const end = Math.min(offset + Number(query.get('limit')), 60)
  const page = Array.from({ length: end - offset }, (_, n) => passage(offset + n))
  return { total: 60, passages: page, outline: OUTLINE }
}

const requested: string[] = []
// Answers the list with `documents` and a document's passages with `passages`, which
// may read the query (a status number makes that call fail).
function mockGateway(
  documents: object[],
  passages: Listing | number | ((query: URLSearchParams) => Listing) = LISTING,
) {
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url)
    const { pathname, searchParams } = new URL(url, 'http://app')
    if (pathname.endsWith('/passages')) {
      return Promise.resolve(
        typeof passages === 'number'
          ? Response.json({ error: 'The passages could not be loaded.' }, { status: passages })
          : Response.json(typeof passages === 'function' ? passages(searchParams) : passages),
      )
    }
    if (pathname.startsWith('/api/chat/passages/')) {
      return Promise.resolve(
        Response.json({
          ...TABLE,
          documentId: 'nfpa',
          boxes: [],
          region: { kind: 'table', boxes: [{ page: 30, l: 60, t: 700, r: 360, b: 500 }] },
        }),
      )
    }
    const answer = url === '/api/knowledge-documents/ingested' ? documents : []
    return Promise.resolve(Response.json(answer))
  })
}
// The passage listings requested, as their query strings.
const listings = () =>
  requested.filter((url) => url.includes('/passages?')).map((url) => url.split('?')[1])

// Opens a document's details, then its passages.
async function openPassages(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))
  const details = screen.getByRole('dialog', { name: title })
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

    const details = screen.getByRole('dialog', { name: 'NFPA 13 sprinkler standard' })
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

    choose('Source type', 'NFPA standards')

    expect(screen.getByRole('button', { name: /^NFPA 13 sprinkler standard/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^FM 2-0 Installation/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 documents')).toBeVisible()
  })

  it('shows the list, not the Review page, when an engineer opens a Review link', async () => {
    mockGateway([UNREVIEWED])
    window.history.replaceState(null, '', '/admin/knowledge-base/review/nfpa-2025')
    render(<App />)
    await signIn('risk_engineer')

    expect(await screen.findByRole('table', { name: 'Documents' })).toBeVisible()
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(requested.some((url) => url.endsWith('/comparison'))).toBe(false)
  })
})

describe("A document's passages (IN-17)", () => {
  it('shows a page of them as a table: position, nearest heading, excerpt, type and pages', async () => {
    mockGateway([NFPA])
    await openAsEngineer()

    const dialog = await openPassages('NFPA 13 sprinkler standard')

    const table = await within(dialog).findByRole('table')
    const head = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(head).toEqual(['#', 'Section', 'Passage', 'Type', 'Pages'])
    const [first, second, third] = within(table).getAllByRole('row').slice(1)
    expect(
      within(first)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['1', '8.1 Basic requirements', LONG_TEXT, 'Text', '12–13'])
    expect(second).toHaveTextContent('Table')
    expect(third).toHaveTextContent('No heading')
    expect(third).toHaveTextContent('PictureGenerated')
    expect(listings()).toEqual(['offset=0&limit=25'])
  })

  it('pages through them with Next and Previous, saying which passages show', async () => {
    mockGateway([NFPA], sixty)
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    const pager = await within(dialog).findByRole('navigation', { name: 'Pages' })
    expect(within(dialog).getByText('Passages 1–25 of 60')).toBeVisible()
    expect(pager).toHaveTextContent('Page 1 of 3')
    expect(within(pager).getByRole('button', { name: 'Previous page' })).toBeDisabled()

    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(await within(dialog).findByText('Passages 26–50 of 60')).toBeVisible()
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(await within(dialog).findByText('Passages 51–60 of 60')).toBeVisible()
    expect(within(pager).getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }))

    expect(await within(dialog).findByText('Passages 26–50 of 60')).toBeVisible()
    expect(listings()).toEqual([
      'offset=0&limit=25',
      'offset=25&limit=25',
      'offset=50&limit=25',
      'offset=25&limit=25',
    ])
  })

  it('filters by chapter, then by that chapter’s section, from page 1', async () => {
    const SECTIONS = [
      { name: '', count: 2, title: null },
      {
        name: '8.1',
        count: 20,
        title: 'Basic requirements for sprinklers installed in rack storage over 12 m high',
      },
      { name: '8.2', count: 18, title: null },
    ]
    mockGateway([NFPA], (query) => ({
      ...sixty(query),
      outline: { ...OUTLINE, sections: query.has('chapter') ? SECTIONS : [] },
    }))
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Next page' }))
    await within(dialog).findByText('Passages 26–50 of 60')

    const chapter = within(dialog).getByLabelText('Chapter')
    const section = within(dialog).getByLabelText('Section')
    expect([...chapter.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All chapters',
      'Front matter (4)',
      'Chapter 8 Installation (40)',
      'Annex A Explanatory material (16)',
    ])
    expect(section).toBeDisabled()
    fireEvent.change(chapter, { target: { value: 'c:8' } })

    await within(dialog).findByText('Passages 1–25 of 60')
    expect(section).toBeEnabled()
    expect([...section.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All sections',
      'Chapter start (2)',
      // A long title ends at a whole word, so a dropdown doesn't grow to a paragraph.
      '8.1 Basic requirements for sprinklers installed in rack… (20)',
      '8.2 (18)',
    ])
    fireEvent.change(section, { target: { value: 's:8.2' } })
    fireEvent.change(chapter, { target: { value: 'c:' } })

    await vi.waitFor(() =>
      expect(listings().slice(2)).toEqual([
        'offset=0&limit=25&chapter=8',
        'offset=0&limit=25&chapter=8&section=8.2',
        'offset=0&limit=25&chapter=',
      ]),
    )
    expect(section).toHaveValue('')
  })

  it('filters a past report by its template sections, in one dropdown', async () => {
    const byTemplate = {
      by: 'section',
      chapters: [
        { name: 'Fire protection', count: 12, title: null },
        { name: 'Undefined', count: 3, title: null },
      ],
      sections: [],
    }
    mockGateway([NFPA], { ...LISTING, outline: byTemplate })
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')

    const sections = await within(dialog).findByLabelText('Section')
    expect(within(dialog).queryByLabelText('Chapter')).not.toBeInTheDocument()
    expect([...sections.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All sections',
      'Fire protection (12)',
      'Undefined (3)',
    ])
    fireEvent.change(sections, { target: { value: 'c:Fire protection' } })

    await vi.waitFor(() =>
      expect(listings()).toContain('offset=0&limit=25&chapter=Fire+protection'),
    )
  })

  it('narrows them to a page range from page 1, and won’t list a range that ends before it starts', async () => {
    mockGateway([NFPA], sixty)
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Next page' }))
    await within(dialog).findByText('Passages 26–50 of 60')
    const from = within(dialog).getByLabelText('From page')
    const to = within(dialog).getByLabelText('To page')

    fireEvent.change(from, { target: { value: '20' } })
    fireEvent.change(to, { target: { value: '30' } })
    await vi.waitFor(() =>
      expect(listings().at(-1)).toBe('offset=0&limit=25&pageFrom=20&pageTo=30'),
    )
    const asked = listings().length
    fireEvent.change(from, { target: { value: '31' } })

    expect(await within(dialog).findByText('The range ends before it starts.')).toBeVisible()
    expect(to).toHaveAttribute('aria-invalid', 'true')
    expect(listings()).toHaveLength(asked)
  })

  it('opens a row to show the passage in full, one row at a time', async () => {
    mockGateway([NFPA])
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')

    const first = await within(dialog).findByRole('button', { name: '8.1 Basic requirements' })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(first)

    expect(first).toHaveAttribute('aria-expanded', 'true')
    const opened = within(dialog).getByRole('region', { name: 'Passage 1' })
    expect(within(opened).getByText(LONG_TEXT)).toBeVisible()
    expect(opened).not.toHaveTextContent('Passage ID')
    // Plain text has no region of the page to fetch.
    expect(requested.some((url) => url.startsWith('/api/chat/passages/'))).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: '8.2 Spacing' }))
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).getByRole('region', { name: 'Passage 2' })).toBeVisible()
    await vi.waitFor(() => expect(requested).toContain('/api/chat/passages/nfpa%3A1'))
  })

  // KB-02: the original comes first, as in chat; under a long description it was off-screen.
  it('shows a table’s region of the original page above its text', async () => {
    mockGateway([NFPA])
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')

    fireEvent.click(await within(dialog).findByRole('button', { name: '8.2 Spacing' }))

    const opened = within(dialog).getByRole('region', { name: 'Passage 2' })
    const region = await within(opened).findByRole('img', { name: 'table on the original page' })
    const text = within(opened).getByText('Passage 2 text.')
    expect(region.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['needs review', UNREVIEWED, 'while this document needs review'],
    [
      'is withdrawn',
      {
        ...NFPA,
        withdrawn: { at: '2026-10-01T00:00:00.000Z', by: { id: 'u1', name: 'Sana Patel' } },
      },
      'while this document is withdrawn',
    ],
  ])('says the passages aren’t searched while the document %s', async (_, document, why) => {
    mockGateway([document])
    await openAsEngineer()

    const dialog = await openPassages(document.title)

    expect(
      await within(dialog).findByText(new RegExp(`aren’t used in answers or search ${why}`)),
    ).toBeVisible()
  })

  it('says so when the active document’s passages all show', async () => {
    mockGateway([NFPA])
    await openAsEngineer()

    const dialog = await openPassages('NFPA 13 sprinkler standard')

    await within(dialog).findByRole('table')
    expect(within(dialog).queryByText(/aren’t used in answers/)).not.toBeInTheDocument()
  })

  it('says when no passage matches the filters, and clears them', async () => {
    mockGateway([NFPA], (query) =>
      query.has('pageFrom') ? { ...LISTING, total: 0, passages: [] } : LISTING,
    )
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    fireEvent.change(await within(dialog).findByLabelText('Chapter'), { target: { value: 'c:8' } })
    fireEvent.change(within(dialog).getByLabelText('From page'), { target: { value: '900' } })

    expect(await within(dialog).findByText('No passages match')).toBeVisible()
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Clear filters' })[0])

    expect(await within(dialog).findByRole('table')).toBeVisible()
    expect(within(dialog).getByLabelText('Chapter')).toHaveValue('')
    expect(within(dialog).getByLabelText('From page')).toHaveValue(null)
    expect(listings().at(-1)).toBe('offset=0&limit=25')
  })

  it('says so when a document has no passages', async () => {
    mockGateway([NFPA], {
      ...LISTING,
      total: 0,
      passages: [],
      outline: { ...OUTLINE, chapters: [] },
    })
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

    expect(await within(dialog).findByRole('table')).toBeVisible()
  })
})

describe("Searching a document's passages by words (IN-17)", () => {
  // The best matches, ranked, as the gateway answers a search.
  const RANKED = { total: 2, passages: [TABLE, FIRST], outline: OUTLINE }

  it('searches once typing pauses, from page 1, and shows the ranked matches', async () => {
    mockGateway([NFPA], (query) => (query.has('q') ? RANKED : sixty(query)))
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Next page' }))
    await within(dialog).findByText('Passages 26–50 of 60')
    const search = within(dialog).getByRole('searchbox', { name: 'Search this document' })

    fireEvent.change(search, { target: { value: 'co' } })
    fireEvent.change(search, { target: { value: ' cold store ' } })

    expect(await within(dialog).findByText('Passages 1–2 of 2')).toBeVisible()
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('8.2 Spacing')
    expect(rows[1]).toHaveTextContent('8.1 Basic requirements')
    // Only the settled words are searched, and nothing in between.
    expect(listings()).toEqual([
      'offset=0&limit=25',
      'offset=25&limit=25',
      'offset=0&limit=25&q=cold+store',
    ])
  })

  it('goes back to paging through the document when the search is emptied', async () => {
    mockGateway([NFPA], (query) => (query.has('q') ? RANKED : sixty(query)))
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    const search = await within(dialog).findByRole('searchbox', { name: 'Search this document' })
    fireEvent.change(search, { target: { value: 'pump' } })
    await within(dialog).findByText('Passages 1–2 of 2')
    expect(within(dialog).getByRole('button', { name: 'Clear filters' })).toBeVisible()

    fireEvent.change(search, { target: { value: '' } })

    expect(await within(dialog).findByText('Passages 1–25 of 60')).toBeVisible()
    expect(listings().at(-1)).toBe('offset=0&limit=25')
    expect(within(dialog).queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('can’t search a document that needs review, as search skips its passages', async () => {
    mockGateway([UNREVIEWED])
    await openAsEngineer()

    const dialog = await openPassages(UNREVIEWED.title)

    const search = await within(dialog).findByRole('searchbox', { name: 'Search this document' })
    expect(search).toBeDisabled()
    expect(search).toHaveAttribute('title', 'Search works once this document is active.')
  })
})

describe("Searching a document's passages by meaning (IN-17)", () => {
  const RANKED = { total: 2, passages: [TABLE, FIRST], outline: OUTLINE }
  const QUESTION = 'how often are valves checked'
  const byMeaning = () => listings().filter((q) => q.includes('mode=meaning'))

  async function openSearch() {
    mockGateway([NFPA], (query) => (query.has('q') ? RANKED : sixty(query)))
    await openAsEngineer()
    const dialog = await openPassages('NFPA 13 sprinkler standard')
    const search = await within(dialog).findByRole('searchbox', { name: 'Search this document' })
    return { dialog, search }
  }

  it('searches by meaning only when Enter is pressed, saying so until then', async () => {
    const { dialog, search } = await openSearch()

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Meaning' }))
    expect(search).toHaveAttribute(
      'placeholder',
      'Describe what you’re looking for, then press Enter',
    )
    fireEvent.change(search, { target: { value: QUESTION } })
    expect(within(dialog).getByText('Press Enter to search')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(byMeaning()).toEqual([])

    fireEvent.keyDown(search, { key: 'Enter' })

    expect(
      await within(dialog).findByText(`Passages 1–2 of 2 matching “${QUESTION}”`),
    ).toBeVisible()
    expect(byMeaning()).toEqual(['offset=0&limit=25&q=how+often+are+valves+checked&mode=meaning'])
    expect(within(dialog).queryByText('Press Enter to search')).not.toBeInTheDocument()
  })

  it('searches by meaning at once when switched to with words typed', async () => {
    const { dialog, search } = await openSearch()
    fireEvent.change(search, { target: { value: QUESTION } })
    await within(dialog).findByText('Passages 1–2 of 2')

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Meaning' }))

    await vi.waitFor(() => expect(byMeaning()).toHaveLength(1))
  })

  it('offers neither search for a document that needs review', async () => {
    mockGateway([UNREVIEWED])
    await openAsEngineer()

    const dialog = await openPassages(UNREVIEWED.title)

    await within(dialog).findByRole('table')
    expect(within(dialog).getByRole('radio', { name: 'Words' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Meaning' })).toBeDisabled()
  })
})
