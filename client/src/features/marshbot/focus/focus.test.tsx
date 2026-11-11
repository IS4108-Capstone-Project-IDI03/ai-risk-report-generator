// AS-06 (AC 2, AC 12): the Assessments list shows each row's stage and priority mark, the Focus
// button opens the top three with the agreed words, See all opens the full ranked list, and the
// Clients list marks a client with its most urgent assessment. Calls App with a stubbed gateway.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from '../../../App'
import { signIn } from '../../../test/session'
import { created, gateway, json } from '../../new-assessment/testKit'
import type { Priority } from '../types'

const LATE: Priority = {
  reason: 'overdue',
  text: 'Report 3 days overdue, nothing drafted yet.',
  rank: 1,
}
const FIX: Priority = {
  reason: 'fix_now',
  text: "A recording from Bay 4 couldn't be transcribed.",
  rank: 2,
}
const SHORT: Priority = {
  reason: 'short_on_time',
  text: 'Survey in 2 days, no checklist yet.',
  rank: 3,
}

// Four assessments in Focus, the first three of them at the client "Harbourline Properties".
const ROWS = [
  { ...created('RPT-2026-0001', 'Site A'), stage: 'capture', priority: LATE },
  { ...created('RPT-2026-0002', 'Site B'), stage: 'ready_for_generation', priority: FIX },
  { ...created('RPT-2026-0003', 'Site C'), stage: 'prepare', priority: SHORT },
  { ...created('RPT-2026-0004', 'Site D'), stage: 'review', priority: SHORT },
  { ...created('RPT-2026-0005', 'Site E'), stage: 'exported', priority: null },
]
// Focus is built from the list's rows (each row's priority), so the rows are the whole fixture.
function serve(rows: typeof ROWS = ROWS) {
  gateway({
    'GET /api/assessments': () => json(200, rows),
    'GET /api/notifications/count': () =>
      json(200, { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null }),
    'GET /api/clients': () => json(200, []),
  })
}
async function openList() {
  window.history.pushState({}, '', '/assessments')
  render(<App />)
  await signIn()
  await screen.findByText('RPT-2026-0001')
}
const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`.at-row[data-id="${reference}"]`)!

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

describe('Stage and priority marks on the Assessments list', () => {
  it('shows each row its stage and, for an urgent one, a mark with its reason', async () => {
    serve()
    await openList()
    expect(within(rowOf('RPT-2026-0001')).getByText('Capture')).toBeInTheDocument()
    expect(within(rowOf('RPT-2026-0002')).getByText('Ready for generation')).toBeInTheDocument()
    expect(within(rowOf('RPT-2026-0005')).getByText('Exported')).toBeInTheDocument()
    // The old status words are gone from the rows.
    expect(within(rowOf('RPT-2026-0001')).queryByText('Not started')).not.toBeInTheDocument()

    // The reason is in the row button's name, and the mark inside it says it on hover; a row
    // with no priority has none.
    const open = within(rowOf('RPT-2026-0001')).getByRole('button', {
      name: /^Site A, RPT-2026-0001/,
    })
    expect(open).toHaveAccessibleName(expect.stringContaining(LATE.text))
    const mark = open.querySelector<HTMLElement>('.mb-mark')!
    expect(rowOf('RPT-2026-0005').querySelector('.mb-mark')).toBeNull()
    fireEvent.mouseEnter(mark.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent(LATE.text)
  })
})

describe('Focus', () => {
  it('opens the top three, ranked, with the agreed words, and a row opens its assessment', async () => {
    serve()
    await openList()
    fireEvent.click(await screen.findByRole('button', { name: 'Focus, 4 assessments' }))
    const pop = screen.getByRole('dialog', { name: 'Focus list' })
    expect(within(pop).getByRole('heading', { name: 'Focus list' })).toBeInTheDocument()
    expect(
      within(pop).getByText('The three most urgent assessments for you to work on first.'),
    ).toBeInTheDocument()
    const rows = within(pop).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^1RPT-2026-0001Report 3 days overdue/),
      expect.stringMatching(/^2RPT-2026-0002A recording from Bay 4/),
      expect.stringMatching(/^3RPT-2026-0003Survey in 2 days/),
    ])
    expect(rows[0]).toHaveTextContent('Harbourline Properties › Site A')

    fireEvent.click(within(rows[1]).getByRole('button'))
    expect(await screen.findByRole('tab', { name: /Observations/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Focus list' })).not.toBeInTheDocument()
  })

  it('See all opens every assessment in Focus, ranked, with its Report due cell', async () => {
    serve()
    await openList()
    fireEvent.click(await screen.findByRole('button', { name: 'Focus, 4 assessments' }))
    fireEvent.click(screen.getByRole('button', { name: 'See all 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Focus list' })
    expect(within(dialog).getByText('4 assessments, most urgent first.')).toBeInTheDocument()
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[3]).toHaveTextContent('RPT-2026-0004')
    expect(rows[3]).toHaveTextContent('26 Nov 2026')
  })

  it('is hidden while nothing is in Focus', async () => {
    serve(ROWS.map((r) => ({ ...r, priority: null })))
    await openList()
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Focus/ })).toBeNull())
  })
})

describe('Clients list', () => {
  it('marks a client with its most urgent assessment and names every reason on hover', async () => {
    serve()
    await openList()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Clients' }))[0])
    await screen.findByRole('heading', { name: 'Clients', level: 1 })
    const table = await screen.findByRole('table', { name: 'Your clients' })
    const open = within(table).getByRole('button', { name: /^Open Harbourline Properties/ })
    // One client holds all five assessments: the button's name carries every reason.
    for (const p of [LATE, FIX, SHORT])
      expect(open).toHaveAccessibleName(expect.stringContaining(p.text))
    // The mark is the most urgent one's (overdue), and its tooltip lists each reason.
    const mark = open.querySelector<HTMLElement>('.mb-mark')!
    expect(mark).toHaveAttribute('data-reason', 'overdue')
    fireEvent.mouseEnter(mark.parentElement!)
    const tip = screen.getByRole('tooltip')
    for (const p of [LATE, FIX, SHORT]) expect(tip).toHaveTextContent(p.text)
  })
})
