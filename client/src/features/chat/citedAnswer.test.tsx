// Tests for the cited-answer components (CB-01 AC1, AC2, AC3, AC7, AC14). A hand-written
// OpenUI Lang answer is rendered the way the chat screen renders a streamed one.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Renderer } from '@openuidev/react-lang'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CitationSelectionContext } from './components/citationSelection'
import { DocumentsContext, type DocSummary } from './components/documents'
import { DeclineContext } from './components/declineContext'
import { chatLibrary } from './library'

afterEach(cleanup)

// What the model streams: the root first, then each statement and its citations.
const body = [
  'root = Answer([s1, t1], meta)',
  's1 = Statement("Ordinary Hazard Group 2 needs 0.20 gpm/ft² over 1,500 ft².", [c1])',
  'c1 = Cite("P1", "0.20 gpm/ft2 over 1500 ft2")',
  't1 = CitedTable(["Edition", "Density"], [[Cell("2019", [c2]), Cell("0.20", [c2])]])',
  'c2 = Cite("P2", "a quote the model made up")',
].join('\n')

// What the server appends once its quote check has run (the last line of every answer).
const meta =
  'meta = Meta([{label: "P1", documentId: "d1", pageStart: 12, pageEnd: 12, withdrawn: false}, ' +
  '{label: "P2", documentId: "d2", pageStart: 40, pageEnd: 41, withdrawn: true}], ' +
  '[{label: "P2", quote: "a quote the model made up"}])'

const DOCS = new Map<string, DocSummary>([
  [
    'd1',
    {
      title: 'FM Data Sheet 2-0',
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

function renderAnswer(response: string, select = vi.fn(), isStreaming = false) {
  render(
    <DocumentsContext.Provider value={DOCS}>
      <CitationSelectionContext.Provider value={{ selected: null, select, close: vi.fn() }}>
        <Renderer response={response} library={chatLibrary} isStreaming={isStreaming} />
      </CitationSelectionContext.Provider>
    </DocumentsContext.Provider>,
  )
  return select
}

describe('Cited answer', () => {
  it('shows statements and table cells with citation markers while streaming', () => {
    renderAnswer(body, vi.fn(), true)

    expect(screen.getByText(/Ordinary Hazard Group 2 needs/)).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /2019/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Citation 1/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Citation 2/ })).toHaveLength(2)
  })

  it('numbers citations in the order they first appear, whatever the passage label', () => {
    renderAnswer(
      [
        'root = Answer([s1], meta)',
        's1 = Statement("Keep 18 in.", [c1, c2])',
        'c1 = Cite("P3", "18 in.")',
        'c2 = Cite("P1", "clearance")',
      ].join('\n'),
    )
    const [first, second] = screen.getAllByRole('button', { name: /^Citation/ })
    expect(first).toHaveTextContent('1')
    expect(second).toHaveTextContent('2')
  })

  it('gives each different quote its own number, even from the same passage', () => {
    renderAnswer(
      [
        'root = Answer([s1, s2])',
        's1 = Statement("Test every 20 years.", [c1, c2])',
        's2 = Statement("Retest every 10 years.", [c1])',
        'c1 = Cite("P2", "installed for 20 years")',
        'c2 = Cite("P2", "retested every 10 years")',
      ].join('\n'),
    )
    const numbers = screen.getAllByRole('button', { name: /^Citation/ }).map((m) => m.textContent)
    expect(numbers).toEqual(['1', '2', '1'])
  })

  it('names each marker by its document and page once the check arrives (AC1)', () => {
    renderAnswer(`${body}\n${meta}`)
    expect(
      screen.getByRole('button', { name: 'Citation 1: FM Data Sheet 2-0 (2026), page 12' }),
    ).toBeInTheDocument()
  })

  it('marks a citation unverified and a withdrawn edition once the check arrives (AC2, AC14)', () => {
    renderAnswer(`${body}\n${meta}`)

    const [good] = screen.getAllByRole('button', { name: /^Citation 1/ })
    expect(good).not.toHaveAccessibleName(/unverified|withdrawn/i)
    const bad = screen.getAllByRole('button', { name: /^Citation 2/ })
    bad.forEach((marker) => expect(marker).toHaveAccessibleName(/unverified, withdrawn edition/i))
    expect(within(bad[0]).getByText('!')).toBeInTheDocument()
  })

  it('marks only the citation whose passage lacks the words, not every use of them', () => {
    renderAnswer(
      [
        'root = Answer([s1], meta)',
        's1 = Statement("Keep 18 in.", [c1, c2])',
        'c1 = Cite("P1", "18 in. clearance")',
        'c2 = Cite("P3", "18 in. clearance")',
        'meta = Meta([{label: "P1", documentId: "d1"}, {label: "P3", documentId: "d1"}], ' +
          '[{label: "P3", quote: "18 in. clearance"}])',
      ].join('\n'),
    )
    const [first, second] = screen.getAllByRole('button', { name: /^Citation/ })
    expect(first).not.toHaveAccessibleName(/unverified/i)
    expect(second).toHaveAccessibleName(/unverified/i)
  })

  it('opens the citation in the source panel when a marker is chosen', () => {
    const select = renderAnswer(`${body}\n${meta}`)
    fireEvent.click(screen.getByRole('button', { name: /^Citation 1/ }))
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 1,
        quote: '0.20 gpm/ft2 over 1500 ft2',
        state: 'verified',
      }),
      expect.any(HTMLElement),
    )
  })

  it("carries the passage's id from the server's meta line to the opened citation (CB-02)", () => {
    const select = renderAnswer(
      `${body}\n${meta.replace('label: "P1", documentId: "d1"', 'label: "P1", documentId: "d1", passageId: "c1"')}`,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Citation 1/ }))
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ passageId: 'c1' }) }),
      expect.any(HTMLElement),
    )
  })

  it('flows a paragraph of statements into one block, with document names in bold', () => {
    renderAnswer(
      [
        'root = Answer([p1])',
        'p1 = Paragraph([s1, s2])',
        's1 = Statement("**NFPA 25 (2026)** asks for a sample test.", [c1])',
        's2 = Statement("Retest every 10 years.", [c1])',
        'c1 = Cite("P1", "sample")',
      ].join('\n'),
    )
    const name = screen.getByText('NFPA 25 (2026)')
    expect(name.tagName).toBe('STRONG')
    expect(name.closest('p')).toHaveTextContent(/asks for a sample test\..*Retest every 10 years\./)
    expect(screen.queryByText('AI answer')).not.toBeInTheDocument()
  })

  it('gives each report its own paragraph and ends with a follow-up question', () => {
    renderAnswer(
      [
        'root = Answer([p1, p2, f1])',
        'p1 = Paragraph([s1])',
        's1 = Statement("**Office Sample 1** found the pump run weekly.", [c1])',
        'p2 = Paragraph([s2])',
        's2 = Statement("**Office Sample 2** found no churn test records.", [c1])',
        'c1 = Cite("P1", "weekly")',
        'f1 = FollowUp("Want me to check what NFPA 25 asks for the same test?")',
      ].join('\n'),
    )
    expect(screen.getByText('Office Sample 1').closest('p')).not.toBe(
      screen.getByText('Office Sample 2').closest('p'),
    )
    const followUp = screen.getByText('Want me to check what NFPA 25 asks for the same test?')
    // A question to pick up, not a claim: it carries no citation marker.
    expect(followUp.closest('p')).not.toHaveTextContent(/\d$/)
    expect(followUp.compareDocumentPosition(screen.getByText('Office Sample 2'))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
  })

  it('writes the section sign as the word Section (Jesper, 17 Oct)', () => {
    renderAnswer(
      [
        'root = Answer([s1, f1])',
        's1 = Statement("See § 8.15.1, §9.2 and §§ 10.1–10.3.", [c1])',
        'c1 = Cite("P1", "§ 8.15.1")',
        'f1 = FollowUp("Want me to check §8.16?")',
      ].join('\n'),
    )
    expect(
      screen.getByText(/See Section 8\.15\.1, Section 9\.2 and Sections 10\.1–10\.3\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Want me to check Section 8.16?')).toBeInTheDocument()
    expect(screen.queryByText(/§/)).toBeNull()
  })

  it('shows a document name in a follow-up question in bold, like the answer', () => {
    renderAnswer(
      [
        'root = Answer([f1])',
        'f1 = FollowUp("**Office Sample 2** also covers its transfer pump. Want me to go through it?")',
      ].join('\n'),
    )
    expect(screen.getAllByText('Office Sample 2').at(-1)!.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('opens a citation from the keyboard with Enter', () => {
    const select = renderAnswer(`${body}\n${meta}`)
    const marker = screen.getByRole('button', { name: /^Citation 1/ })
    expect(marker).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(marker, { key: 'Enter' })
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ number: 1 }), marker)
  })

  it('shows a declined answer as a plain reply, with Add documents for an admin (CB-07)', () => {
    render(
      <DeclineContext.Provider value={{ isAdmin: true, notify: vi.fn() }}>
        <Renderer
          response={
            'root = Answer([s1], meta)\ns1 = Statement("The knowledge base cannot answer this question.", [])'
          }
          library={chatLibrary}
          isStreaming={false}
        />
      </DeclineContext.Provider>,
    )
    expect(screen.getByText("I couldn't find that in the knowledge base.")).toBeInTheDocument()
    expect(screen.getByText('Would you like to add the document yourself?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add documents' })).toBeInTheDocument()
    expect(screen.queryByText('No answer in the knowledge base')).toBeNull()
  })
})
