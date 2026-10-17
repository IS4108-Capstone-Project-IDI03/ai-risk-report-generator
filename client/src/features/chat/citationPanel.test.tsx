// Tests for the source panel beside the conversation (CB-01 AC1, AC2, AC14): where a
// chosen citation came from, and whether its quoted words were found there.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CitationPanel } from './components/CitationPanel'
import type { SelectedCitation } from './components/citationSelection'
import { DocumentsContext, type DocSummary } from './components/documents'
import { fetchPassage, type Passage } from './api'

// jsdom can't run pdf.js: the mock draws the page's size and text items, which is all
// the panel feeds it. `pdf.crash` makes the page throw, as pdf.js does on an old browser.
const pdf = vi.hoisted(() => ({ crash: false }))
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ file, children }: { file: string; children: React.ReactNode }) => (
    <div data-testid="pdf-document" data-file={file}>
      {children}
    </div>
  ),
  Page: (props: {
    pageNumber: number
    onLoadSuccess: (p: object) => void
    onGetTextSuccess: (t: object) => void
    customTextRenderer?: (i: { itemIndex: number }) => string
  }) => {
    if (pdf.crash) throw new Error('getOrInsertComputed is not a function')
    // Called once on mount, as react-pdf does when the page has loaded.
    React.useEffect(() => {
      props.onLoadSuccess({ originalWidth: 600, originalHeight: 800 })
      props.onGetTextSuccess({
        items: [{ str: 'Visually inspect' }, { str: 'indicating control valves.' }],
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <div data-testid="pdf-page" data-page={props.pageNumber}>
        {[0, 1].map((i) => (
          <span
            key={i}
            data-testid="pdf-item"
            dangerouslySetInnerHTML={{ __html: props.customTextRenderer?.({ itemIndex: i }) ?? '' }}
          />
        ))}
      </div>
    )
  },
}))
vi.mock('./api', () => ({ fetchPassage: vi.fn() }))

afterEach(cleanup)

const PASSAGE: Passage = {
  id: 'c1',
  documentId: 'd1',
  text: 'Weekly:\nVisually inspect indicating control valves.\nRecord the result.',
  headings: ['Inspection'],
  pageStart: 50,
  pageEnd: 52,
  boxes: [{ page: 51, l: 60, t: 700, r: 360, b: 500 }],
}
// Block body: a function returned from beforeEach would be run by vitest as cleanup.
beforeEach(() => {
  vi.mocked(fetchPassage).mockResolvedValue(PASSAGE)
})

const DOCS = new Map<string, DocSummary>([
  [
    'd1',
    {
      title: 'FM Data Sheet 2-81',
      kind: 'standard',
      edition: '2026',
      fileUrl: '/f/d1',
      withdrawn: false,
    },
  ],
  [
    'd2',
    {
      title: 'NFPA 13',
      kind: 'standard',
      edition: '2019',
      fileUrl: '/f/d2',
      withdrawn: true,
      newerEdition: { id: 'd3', title: 'NFPA 13', edition: '2022' },
    },
  ],
])

const cited = (over: Partial<SelectedCitation> = {}): SelectedCitation => ({
  number: 2,
  passage: 'P1',
  quote: 'Visually inspect indicating control valves',
  state: 'verified',
  source: {
    label: 'P1',
    documentId: 'd1',
    passageId: 'c1',
    pageStart: 50,
    pageEnd: 52,
    withdrawn: false,
  },
  ...over,
})

function renderPanel(selected: SelectedCitation, close = vi.fn()) {
  render(
    <DocumentsContext.Provider value={DOCS}>
      <CitationPanel selected={selected} onClose={close} />
    </DocumentsContext.Provider>,
  )
  return close
}

describe('Source panel', () => {
  it('shows the document, edition, pages, quoted words and that they were found (AC1)', () => {
    renderPanel(cited())
    const panel = screen.getByRole('complementary', { name: 'Source of citation 2' })
    expect(panel).toHaveTextContent('FM Data Sheet 2-81')
    expect(panel).toHaveTextContent('2026')
    expect(panel).toHaveTextContent('50–52')
    expect(panel).toHaveTextContent('Visually inspect indicating control valves')
    expect(panel).toHaveTextContent('Quoted words found in the source')
    expect(screen.getByRole('link', { name: /Open the original PDF at page 50/ })).toHaveAttribute(
      'href',
      '/f/d1#page=50',
    )
  })

  it('warns when the quoted words were not found in the source (AC2)', () => {
    renderPanel(cited({ state: 'unverified' }))
    expect(screen.getByText(/weren't found in the cited passage/)).toBeInTheDocument()
  })

  it('labels a withdrawn edition (AC14)', () => {
    renderPanel(
      cited({ source: { label: 'P1', documentId: 'd2', pageStart: 40, withdrawn: true } }),
    )
    expect(screen.getByText('Withdrawn')).toBeInTheDocument()
  })

  it('closes from its button and from the Escape key', () => {
    const close = renderPanel(cited())
    fireEvent.click(screen.getByRole('button', { name: 'Close source' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('warns that a newer edition exists, naming it (AC4)', () => {
    renderPanel(
      cited({ source: { label: 'P1', documentId: 'd2', pageStart: 40, withdrawn: true } }),
    )
    expect(
      screen.getByText(/A newer edition is in the knowledge base: NFPA 13 \(2022\)/),
    ).toBeInTheDocument()
  })

  it('shows no newer-edition warning for a current edition (AC4)', () => {
    renderPanel(cited())
    expect(screen.queryByText(/newer edition/i)).not.toBeInTheDocument()
  })
})

describe('Passage tab', () => {
  it('opens on the passage text with the quoted words marked (AC1)', async () => {
    renderPanel(cited())
    const panel = await screen.findByRole('tabpanel', { name: 'Passage' })
    await waitFor(() => expect(panel).toHaveTextContent('Record the result.'))
    expect(fetchPassage).toHaveBeenCalledWith('c1', expect.anything())
    expect(panel.querySelector('mark')).toHaveTextContent(
      'Visually inspect indicating control valves',
    )
    expect(screen.getByRole('tab', { name: 'Passage' })).toHaveAttribute('aria-selected', 'true')
  })

  it('marks quoted words that differ in case, spacing and punctuation (AC1)', async () => {
    renderPanel(cited({ quote: 'visually  INSPECT indicating, control valves' }))
    const panel = await screen.findByRole('tabpanel', { name: 'Passage' })
    await waitFor(() => expect(panel.querySelector('mark')).toBeInTheDocument())
    expect(panel.querySelector('mark')).toHaveTextContent(
      'Visually inspect indicating control valves',
    )
  })

  it('marks nothing when the quote is not in the passage (AC1)', async () => {
    renderPanel(cited({ quote: 'Replace the valve monthly', state: 'unverified' }))
    const panel = await screen.findByRole('tabpanel', { name: 'Passage' })
    await waitFor(() => expect(panel).toHaveTextContent('Record the result.'))
    expect(panel.querySelector('mark')).toBeNull()
  })

  it('says so, and keeps the rest of the panel, when the passage cannot be loaded', async () => {
    vi.mocked(fetchPassage).mockRejectedValue(new Error('down'))
    renderPanel(cited())
    expect(await screen.findByText(/passage couldn't be loaded/)).toBeInTheDocument()
    expect(screen.getByText('FM Data Sheet 2-81')).toBeInTheDocument()
  })
})

describe('PDF tab', () => {
  const openPdf = async () => {
    renderPanel(cited())
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    return screen.findByTestId('pdf-page')
  }

  it('shows the box page of the PDF, with the passage box placed from the bbox (AC2)', async () => {
    const page = await openPdf()
    expect(page).toHaveAttribute('data-page', '51')
    expect(screen.getByTestId('pdf-document')).toHaveAttribute('data-file', '/f/d1')
    // 600 x 800 page; box l60 t700 r360 b500, bottom-left origin: top edge = 800 - 700.
    const box = await screen.findByTestId('passage-box')
    expect(box.style.left).toBe('10%')
    expect(box.style.top).toBe('12.5%')
    expect(box.style.width).toBe('50%')
    expect(box.style.height).toBe('25%')
  })

  it('marks the quoted words in the page text when found there (AC2)', async () => {
    const page = await openPdf()
    await waitFor(() =>
      expect(within(page).getAllByTestId('pdf-item')[0].innerHTML).toContain('<mark>'),
    )
    const marked = [...page.querySelectorAll('mark')].map((m) => m.textContent)
    expect(marked.join(' ')).toBe('Visually inspect indicating control valves')
  })

  it('shows the box alone when the quote is not in the page text', async () => {
    renderPanel(cited({ quote: 'Replace the valve monthly', state: 'unverified' }))
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByTestId('passage-box')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-page').querySelector('mark')).toBeNull()
  })

  it('keeps the panel and points to the original PDF when pdf.js crashes', async () => {
    pdf.crash = true
    vi.spyOn(console, 'error').mockImplementation(() => {}) // React logs the caught error
    renderPanel(cited())
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByText(/page couldn't be shown here/)).toBeInTheDocument()
    expect(screen.getByText('FM Data Sheet 2-81')).toBeInTheDocument()
    pdf.crash = false
  })

  it('falls back to the first page when there is no box', async () => {
    vi.mocked(fetchPassage).mockResolvedValue({ ...PASSAGE, boxes: [] })
    const page = await openPdf()
    expect(page).toHaveAttribute('data-page', '50')
    expect(screen.queryByTestId('passage-box')).not.toBeInTheDocument()
  })
})
