// The owner's practice assessment on the Assessments list (F-12, Architecture 8): one row pinned
// to the top whatever the sort and filters, marked Practice, never counted, and with no Archive or
// Reassign. Same stand-in gateway as reassign.test.tsx.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { created, gateway, json } from '../new-assessment/testKit'

const PRACTICE = {
  ...created('PRACTICE-0001', 'Harbourline Cold Store'),
  client: 'Harbourline Cold Store (practice)',
  clientId: 'practice-client',
  practice: true,
}
// Real rows with later and earlier survey dates, so a sort has something to reorder.
const REAL = [
  { ...created('RPT-2026-0001', 'Jurong Island Depot'), siteVisitDate: '2026-01-05' },
  { ...created('RPT-2026-0002', 'Tuas Cold Store'), siteVisitDate: '2026-12-05' },
]
const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`.at-row[data-id="${reference}"]`)!
const refs = () => [...document.querySelectorAll('.at-row')].map((r) => r.getAttribute('data-id'))

async function openList(role: 'knowledge_admin' | 'risk_engineer' = 'risk_engineer') {
  gateway({
    'GET /api/assessments': () => json(200, [PRACTICE, ...REAL]),
    'GET /api/assessments/assignable-engineers': () => json(200, { items: [] }),
  })
  window.history.pushState({}, '', '/assessments')
  render(<App />)
  await signIn(role)
  await screen.findByText('RPT-2026-0001')
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
  window.history.replaceState(null, '', '/')
})

describe('The practice assessment on the Assessments list', () => {
  it('is the first row and reads as the practice one', async () => {
    await openList()
    expect(refs()[0]).toBe('PRACTICE-0001')
    expect(within(rowOf('PRACTICE-0001')).getByText('Practice')).toBeInTheDocument()
    expect(within(rowOf('RPT-2026-0001')).queryByText('Practice')).toBeNull()
  })

  it('is not counted in the footer', async () => {
    await openList()
    expect(screen.getByText('2 assessments')).toBeInTheDocument()
    expect(screen.queryByText('3 assessments')).toBeNull()
  })

  it('stays first whatever the sort and the filters are', async () => {
    await openList()
    fireEvent.click(screen.getByRole('button', { name: /Sort assessments/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Client name, A to Z' }))
    expect(refs()[0]).toBe('PRACTICE-0001')
    // A search that matches only a real row, and one that matches nothing.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search assessments' }), {
      target: { value: 'Tuas' },
    })
    await waitFor(() => expect(refs()).toEqual(['PRACTICE-0001', 'RPT-2026-0002']))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search assessments' }), {
      target: { value: 'zzzz' },
    })
    await waitFor(() => expect(refs()).toEqual(['PRACTICE-0001']))
    expect(screen.getByText('No assessments match those filters')).toBeInTheDocument()
  })

  it('offers no Archive, and an admin no Reassign, on it', async () => {
    await openList()
    expect(screen.queryByRole('button', { name: 'Archive PRACTICE-0001' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Archive RPT-2026-0001' })).toBeInTheDocument()
    cleanup()
    await openList('knowledge_admin')
    expect(screen.queryByRole('button', { name: 'Reassign PRACTICE-0001' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reassign RPT-2026-0001' })).toBeInTheDocument()
  })

  it('is not on the Calendar', async () => {
    await openList()
    fireEvent.click(
      within(screen.getAllByRole('navigation')[0]).getByRole('button', { name: /^Calendar/ }),
    )
    expect(await screen.findByText('2 assessments')).toBeInTheDocument()
  })
})
