// Tests for the source panel beside the conversation (CB-01 AC1, AC2, AC14): where a
// chosen citation came from, and whether its quoted words were found there.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CitationPanel } from './components/CitationPanel'
import type { SelectedCitation } from './components/citationSelection'
import { DocumentsContext, type DocSummary } from './components/documents'

afterEach(cleanup)

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
    { title: 'NFPA 13', kind: 'standard', edition: '2019', fileUrl: '/f/d2', withdrawn: true },
  ],
])

const cited = (over: Partial<SelectedCitation> = {}): SelectedCitation => ({
  number: 2,
  passage: 'P1',
  quote: 'Visually inspect indicating control valves',
  state: 'verified',
  source: { label: 'P1', documentId: 'd1', pageStart: 50, pageEnd: 52, withdrawn: false },
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
})
