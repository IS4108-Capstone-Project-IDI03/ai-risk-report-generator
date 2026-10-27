// Tests for the source panel beside the conversation (CB-01 AC1, AC2, AC14): where a
// chosen citation came from, and whether its quoted words were found there.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CitationPanel } from './components/CitationPanel'
import type { SelectedCitation } from './components/citationSelection'
import { DocumentsContext, type DocSummary } from './components/documents'
import { fetchPassage, type Passage } from './api'

// jsdom can't run pdf.js: the mock reports the document's 60 pages, each page's size and its
// text (by default two lines, 12pt apart; `pdf.texts` sets a page's own), which is all the
// viewer feeds it. `pdf.crash` makes the page
// throw, as pdf.js does on an old browser. `pdf.loads` counts how often the PDF file is opened
// (once per <Document> mount).
const pdf = vi.hoisted(() => ({
  crash: false,
  loads: 0,
  texts: {} as Record<number, { items: object[] }>,
  options: undefined as object | undefined,
  suspense: [] as (boolean | undefined)[],
  pageLoading: undefined as React.ReactNode,
}))
const TEXT = {
  items: [
    { str: 'Visually inspect', transform: [10, 0, 0, 10, 60, 700], width: 160, height: 10 },
    {
      str: 'indicating control valves.',
      transform: [10, 0, 0, 10, 60, 688],
      width: 260,
      height: 10,
    },
  ],
}
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: (props: {
    file: { range: { url: string } }
    children: React.ReactNode
    options?: object
    suspense?: boolean
    onLoadSuccess: (d: object) => void
  }) => {
    pdf.options = props.options
    pdf.suspense.push(props.suspense)
    React.useEffect(() => {
      pdf.loads++
      props.onLoadSuccess({
        numPages: 60,
        getPage: (n: number) =>
          Promise.resolve({
            getViewport: () => ({ width: 600, height: 800 }),
            getTextContent: () => Promise.resolve(pdf.texts[n] ?? TEXT),
          }),
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <div data-testid="pdf-document" data-file={props.file.range.url}>
        {props.children}
      </div>
    )
  },
  Page: (props: {
    pageNumber: number
    width: number
    suspense?: boolean
    loading?: React.ReactNode
    onLoadSuccess: (p: object) => void
  }) => {
    pdf.suspense.push(props.suspense)
    pdf.pageLoading = props.loading
    if (pdf.crash) throw new Error('getOrInsertComputed is not a function')
    // Called when a page has loaded, as react-pdf does.
    React.useEffect(() => {
      props.onLoadSuccess({
        pageNumber: props.pageNumber,
        originalWidth: 600,
        originalHeight: 800,
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.pageNumber])
    return <div data-testid="pdf-page" data-page={props.pageNumber} data-width={props.width} />
  },
}))
vi.mock('./api', () => ({ fetchPassage: vi.fn() }))
// The byte-range loader (tested in pdfSource.test.ts) stands in as the file's URL.
vi.mock('./components/pdfSource', () => ({ openPdfSource: async (url: string) => ({ url }) }))

afterEach(cleanup)

// Node in CI has no localStorage (a laptop's may), so the width tests bring their own.
function stubLocalStorage() {
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
    clear: () => kept.clear(),
  })
}
afterEach(() => vi.unstubAllGlobals())

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
  // The passage covers pages 50-52 but is outlined on 51 only. Any page not set here reads as TEXT,
  // so 50 and 52 are empty until a test puts words on them.
  pdf.texts = { 50: { items: [] }, 52: { items: [] } }
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
  it('shows the document, edition and the pages the quoted words were found on (AC3)', () => {
    renderPanel(cited())
    const panel = screen.getByRole('complementary', { name: 'Source of citation 2' })
    expect(panel).toHaveTextContent('FM Data Sheet 2-81')
    expect(panel).toHaveTextContent('Edition2026')
    expect(panel).toHaveTextContent('Pages50–52')
    // Jesper (18 Oct): "Found on page N", the pages in bold, then straight into the passage.
    expect(screen.getByText('pages 50–52', { selector: 'strong' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Found on pages 50–52')
    expect(panel).not.toHaveTextContent('highlighted below')
    expect(panel).not.toHaveTextContent('External standard')
    expect(panel.querySelector('blockquote')).toBeNull()
  })

  it('warns when the quoted words were not found in the source (AC2)', () => {
    renderPanel(cited({ state: 'unverified' }))
    expect(screen.getByText('Not found on pages 50–52')).toBeInTheDocument()
    // Nothing is highlighted then, so the quoted words are shown instead.
    expect(screen.getByRole('complementary')).toHaveTextContent(
      '“Visually inspect indicating control valves”',
    )
  })

  it('labels a withdrawn edition (AC14)', () => {
    renderPanel(
      cited({ source: { label: 'P1', documentId: 'd2', pageStart: 40, withdrawn: true } }),
    )
    expect(screen.getByText('Withdrawn')).toBeInTheDocument()
  })

  it('resizes from its handle with the arrow keys, remembering a width per tab', async () => {
    stubLocalStorage()
    renderPanel(cited())
    const handle = screen.getByRole('separator', { name: 'Resize the source panel' })
    expect(handle).toHaveAttribute('aria-valuenow', '40')
    // The handle is the panel's left edge, so Left widens the panel.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '45')
    // Jesper (18 Oct): the PDF tab splits the room half and half with the chat.
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    expect(JSON.parse(localStorage.getItem('chat-panel-share')!)).toMatchObject({ passage: 0.45 })
  })

  it('ignores a stored width that is not a number', () => {
    stubLocalStorage()
    localStorage.setItem('chat-panel-share', '{"passage":"x"}')
    renderPanel(cited())
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '40')
  })

  it('closes from its button and from the Escape key', () => {
    const close = renderPanel(cited())
    fireEvent.click(screen.getByRole('button', { name: 'Close source' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('goes back to the chat from its Back to chat button (narrow screens)', () => {
    const close = renderPanel(cited())
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('warns that a newer edition exists, naming it in bold (AC4)', () => {
    renderPanel(
      cited({ source: { label: 'P1', documentId: 'd2', pageStart: 40, withdrawn: true } }),
    )
    expect(screen.getByText(/Newer edition:/)).toBeInTheDocument()
    expect(screen.getByText('NFPA 13 (2022)').tagName).toBe('STRONG')
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

  it('highlights the quoted words on the page, one line at a time (AC2)', async () => {
    await openPdf()
    const marks = await screen.findAllByTestId('quote-mark')
    expect(marks).toHaveLength(2)
    // Line 1 is all quoted: x 60-220, ink from 698 to 708 on the 600 x 800 page.
    expect(marks[0].style.left).toBe('10%')
    expect(marks[0].style.top).toBe('11.5%')
    expect(marks[0].style.height).toBe('1.25%')
  })

  it('says so, and keeps the outline, when the quote is not in the page text', async () => {
    renderPanel(cited({ quote: 'Replace the valve monthly', state: 'unverified' }))
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByTestId('passage-box')).toBeInTheDocument()
    expect(await screen.findByText(/quoted words couldn't be found on this page/)).toBeVisible()
    expect(screen.queryByTestId('quote-mark')).not.toBeInTheDocument()
  })

  it('looks on every page the passage covers, not only the pages its outline boxes sit on', async () => {
    // A picture passage is outlined on page 51 only, but its words run on to page 52.
    vi.mocked(fetchPassage).mockResolvedValue({
      ...PASSAGE,
      boxes: [{ page: 51, l: 60, t: 700, r: 360, b: 500 }],
    })
    pdf.texts[52] = TEXT
    pdf.texts[51] = {
      items: [{ str: 'Figure 4', transform: [10, 0, 0, 10, 60, 700], width: 70, height: 10 }],
    }
    const page = await openPdf()
    await waitFor(() => expect(page).toHaveAttribute('data-page', '52'))
    expect(await screen.findAllByTestId('quote-mark')).toHaveLength(2)
  })

  it('says a scanned page has no text to highlight, instead of that the words are missing', async () => {
    pdf.texts[51] = { items: [] } // a scan: no text layer on the page
    renderPanel(cited({ quote: 'Replace the valve monthly', state: 'unverified' }))
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByTestId('passage-box')).toBeInTheDocument()
    expect(await screen.findByText(/page is a scan/)).toBeVisible()
    expect(screen.queryByText(/couldn't be found/)).not.toBeInTheDocument()
  })

  it('tells pdf.js where its image decoders are, so image-only pages are drawn', async () => {
    // Without wasmUrl, pdf.js cannot decode JPEG 2000 / JBIG2 page images and draws a blank page.
    await openPdf()
    expect(pdf.options).toMatchObject({ wasmUrl: expect.stringMatching(/wasm\/$/) })
  })

  it('keeps the panel when pdf.js crashes', async () => {
    pdf.crash = true
    vi.spyOn(console, 'error').mockImplementation(() => {}) // React logs the caught error
    renderPanel(cited())
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByText(/PDF couldn't be shown in this browser/)).toBeInTheDocument()
    expect(screen.getByText('FM Data Sheet 2-81')).toBeInTheDocument()
    pdf.crash = false
  })

  it('starts loading the PDF as soon as the citation opens, fetching only what it shows', async () => {
    renderPanel(cited())
    await screen.findByText(/Record the result/)
    // Before the PDF tab is clicked: the document is already loading behind the Passage tab.
    expect(await screen.findByTestId('pdf-document')).not.toBeVisible()
    // Only the ranges pages need: no fetching pages nobody looks at.
    expect(pdf.options).toMatchObject({ disableAutoFetch: true })
  })

  it('loads in place, keeping the toolbar, rather than blanking the viewer', async () => {
    pdf.suspense = []
    await openPdf()
    // Suspending would swap the whole viewer for a fallback while pdf.js loads (the flash
    // Jesper saw, 18 Oct); react-pdf's own placeholder keeps the bar and the page's place.
    expect(new Set(pdf.suspense)).toEqual(new Set([false]))
    render(<>{pdf.pageLoading}</>)
    expect(document.querySelector('.chat-pdf-sheet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  })

  it('keeps the loaded PDF when switching to Passage and back', async () => {
    pdf.loads = 0
    await openPdf()
    fireEvent.click(screen.getByRole('tab', { name: 'Passage' }))
    expect(await screen.findByRole('tabpanel', { name: 'Passage' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    expect(await screen.findByTestId('pdf-page')).toBeVisible()
    expect(pdf.loads).toBe(1)
  })

  it('opens with the whole page fitted, and zooms in and back out', async () => {
    // jsdom has no layout: the frame stands in at 300 x 400, so a 600 x 800 page fits at 300.
    const page = await openPdf()
    await waitFor(() => expect(page).toHaveAttribute('data-width', '300'))
    expect(screen.getByText('Fit')).toBeInTheDocument()
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' })
    expect(zoomOut).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(page).toHaveAttribute('data-width', '375')
    expect(screen.getByText('125%')).toBeInTheDocument()
    fireEvent.click(zoomOut)
    expect(page).toHaveAttribute('data-width', '300')
  })

  it('caps zooming at a 1600px page', async () => {
    // A large expanded viewer: the page fits at 768px wide, so 300% (2304px) is left out.
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2000)
    const page = await openPdf()
    await waitFor(() => expect(page).toHaveAttribute('data-width', '768'))
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    for (let i = 0; i < 3; i++) fireEvent.click(zoomIn)
    expect(page).toHaveAttribute('data-width', '1536')
    expect(zoomIn).toBeDisabled()
    w.mockRestore()
    h.mockRestore()
  })

  it('steps through pages, highlighting only the cited one, and returns to it', async () => {
    const page = await openPdf()
    expect(await screen.findByText('Page 51 of 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(page).toHaveAttribute('data-page', '50')
    expect(screen.queryByTestId('quote-mark')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the cited page (51)' }))
    expect(page).toHaveAttribute('data-page', '51')
    expect(await screen.findAllByTestId('quote-mark')).toHaveLength(2)
  })

  it('opens on the page holding the quote when the passage runs over several pages', async () => {
    // The passage is outlined on pages 51 and 52, but the quoted words are on 52.
    vi.mocked(fetchPassage).mockResolvedValue({
      ...PASSAGE,
      boxes: [
        { page: 51, l: 60, t: 700, r: 360, b: 500 },
        { page: 52, l: 60, t: 760, r: 360, b: 650 },
      ],
    })
    pdf.texts[51] = {
      items: [{ str: 'Weekly:', transform: [10, 0, 0, 10, 60, 700], width: 70, height: 10 }],
    }
    pdf.texts[52] = TEXT
    const page = await openPdf()
    await waitFor(() => expect(page).toHaveAttribute('data-page', '52'))
    expect(await screen.findAllByTestId('quote-mark')).toHaveLength(2)
    expect(screen.getAllByTestId('passage-box')).toHaveLength(1)
    // Page 51 still shows the passage's outline, without highlights.
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(page).toHaveAttribute('data-page', '51')
    expect(screen.getAllByTestId('passage-box')).toHaveLength(1)
    expect(screen.queryByTestId('quote-mark')).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't be found/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the cited page (52)' }))
    expect(page).toHaveAttribute('data-page', '52')
  })

  it('opens the original PDF at the page shown', async () => {
    await openPdf()
    expect(screen.getByRole('link', { name: 'Open the original PDF' })).toHaveAttribute(
      'href',
      '/f/d1#page=51',
    )
  })

  it('expands over the chat, and steps back out with its button or Escape', async () => {
    const close = vi.fn()
    renderPanel(cited(), close)
    await screen.findByText(/Record the result/)
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    const panel = screen.getByRole('complementary')
    fireEvent.click(await screen.findByRole('button', { name: 'Expand' }))
    expect(panel).toHaveAttribute('data-expanded')
    fireEvent.click(screen.getByRole('button', { name: 'Exit full view' }))
    expect(panel).not.toHaveAttribute('data-expanded')
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel).not.toHaveAttribute('data-expanded')
    expect(close).not.toHaveBeenCalled()
  })

  it('falls back to the first page when there is no box', async () => {
    vi.mocked(fetchPassage).mockResolvedValue({ ...PASSAGE, boxes: [] })
    pdf.texts = {} // every page reads as TEXT, so the quote is on the passage's first page
    const page = await openPdf()
    expect(page).toHaveAttribute('data-page', '50')
    expect(screen.queryByTestId('passage-box')).not.toBeInTheDocument()
  })
})
