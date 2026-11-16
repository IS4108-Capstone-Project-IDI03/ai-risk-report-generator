// IN-17: a risk engineer browses the knowledge base read-only. They open the
// Knowledge base screen and see the Documents tab, but nothing that changes a
// document. The gateway is a stubbed fetch.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'

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

const requested: string[] = []
function mockGateway(documents: object[]) {
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url)
    const answer = url === '/api/knowledge-documents/ingested' ? documents : []
    return Promise.resolve(Response.json(answer))
  })
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
})
