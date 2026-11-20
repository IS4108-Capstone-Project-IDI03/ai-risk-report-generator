// IN-18: a draft's citation of a manually entered clause, in the review workspace's
// source viewer. It has no file to open, so its screenshot stands in for the page.
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPassage } from '../chat/api'
import { PassageView } from './components/SourcePanel'

vi.mock('../chat/api', () => ({ fetchPassage: vi.fn() }))
afterEach(cleanup)

const MANUAL = {
  id: 'C:m1:3',
  kind: 'standard' as const,
  text: 'Pipe size: 25 mm; Max spacing: 3.7 m',
  headings: ['8.6 Hangers'],
  pageStart: null,
  pageEnd: null,
  documentId: 'm1',
  document: {
    title: 'NFPA 72',
    issuingBody: 'NFPA',
    sourceType: 'nfpa_standard',
    edition: '2025',
    effectiveDate: '2025-01-01',
    withdrawnAt: null,
    fileUrl: null,
  },
}

describe('a cited manual clause in the review workspace (IN-18)', () => {
  it('shows its screenshot and says it was entered manually, with no PDF to open', async () => {
    vi.mocked(fetchPassage).mockResolvedValue({
      id: 'm1:3',
      documentId: 'm1',
      text: MANUAL.text,
      headings: MANUAL.headings,
      pageStart: null,
      pageEnd: null,
      boxes: [],
      region: null,
      manual: true,
      images: ['knowledge/m1/sections/a.png'],
    })

    render(<PassageView passage={MANUAL} number={1} onClose={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'Screenshot' })).toHaveAttribute(
      'src',
      '/api/knowledge-documents/m1/sections/screenshots/a.png',
    )
    expect(screen.getByText('Manual entry')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open the original PDF/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()
  })
})
