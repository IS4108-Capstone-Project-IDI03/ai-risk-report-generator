// The Assessments list follows changes made in another window (F-10, RV-11 round 2, item 14): a
// moved assessment leaves the old engineer's list and appears on the new one's without a refresh.
// Only the count poller's interval is faked, so everything else settles as usual.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import { created, gateway, json, sent } from '../new-assessment/testKit'

const OMAR = { id: '6ab39017e45cf009e4507735', name: 'Omar Khan' }
const row = (reference: string, extra = {}) => ({
  ...created(reference, 'Site ' + reference),
  ...extra,
})
const A = row('RPT-2026-0001')
const B = row('RPT-2026-0002')
const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`.at-row[data-id="${reference}"]`)

let list: unknown[]
let counts: Record<string, unknown>
const FIRST = { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null }

const poll = () => act(async () => void vi.advanceTimersByTime(10_000))
const reads = () => sent('GET', '/api/assessments').length
const hide = (hidden: boolean) =>
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  })

function serve(extra: Record<string, () => Promise<Response> | Response> = {}) {
  gateway({
    'GET /api/assessments': () => json(200, list),
    'GET /api/notifications/count': () => json(200, counts),
    ...extra,
  })
}
async function openList(role: 'knowledge_admin' | 'risk_engineer' = 'risk_engineer') {
  window.history.pushState({}, '', '/assessments')
  render(<App />)
  await signIn(role)
}

// A sidebar button, for leaving the list and coming back to it.
const goTo = (screenName: 'Inbox' | 'Assessments') =>
  act(
    async () =>
      void fireEvent.click(
        within(screen.getAllByRole('navigation')[0]).getByRole('button', {
          name: new RegExp('^' + screenName),
        }),
      ),
  )

const MADE = row('RPT-2026-0009')
// A gateway that lists a new assessment once it's created, as the real one does.
function serveCreate(extra: Parameters<typeof serve>[0] = {}) {
  serve({
    'GET /api/clients': () => json(200, []),
    'POST /api/assessments': () => {
      list = [MADE]
      return json(201, { clientId: 'c9', assessments: [MADE] })
    },
    ...extra,
  })
}
// Fills in the New Assessment form from the empty list and waits for the row.
async function createOne() {
  await screen.findByText('No assessments yet')
  fireEvent.click(
    within(document.querySelector<HTMLElement>('.at-empty')!).getByRole('button', {
      name: 'New assessment',
    }),
  )
  const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
  type(await screen.findByLabelText(/^Client name/), 'Pacific Crest REIT')
  type(screen.getByLabelText(/^Site name/), 'Tuas Hub')
  type(screen.getByLabelText(/^Facility type/), 'Distribution warehouse')
  type(screen.getByLabelText(/^Address/), '21 Tuas South Ave 3')
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByText(MADE.reference)).toBeInTheDocument()
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  list = [A, B]
  counts = FIRST
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  hide(false)
  window.history.replaceState(null, '', '/')
})

describe('Assessments list following outside changes', () => {
  it('drops a row moved to another engineer, leaving the rest in place', async () => {
    serve()
    await openList()
    await screen.findByText('RPT-2026-0001')
    await poll()
    const kept = rowOf('RPT-2026-0002')

    list = [B]
    counts = { ...FIRST, total: 1, unread: 1, newestBell: '2026-11-06T01:00:00.000Z' }
    await poll()

    await waitFor(() => expect(rowOf('RPT-2026-0001')).toBeNull())
    // The same element: no skeleton in between, nothing drawn again from scratch.
    expect(rowOf('RPT-2026-0002')).toBe(kept)
    expect(rowOf('RPT-2026-0002')).toBeInTheDocument()
  })

  it('shows a row moved to this engineer', async () => {
    list = [B]
    serve()
    await openList()
    await screen.findByText('RPT-2026-0002')
    await poll()

    list = [A, B]
    counts = { ...FIRST, inboxTodo: 1, newestInbox: '2026-11-06T01:00:00.000Z' }
    await poll()

    expect(await screen.findByText('RPT-2026-0001')).toBeInTheDocument()
  })

  it('reads nothing when the poll finds nothing changed', async () => {
    serve()
    await openList()
    await screen.findByText('RPT-2026-0001')
    await poll()
    await poll()
    await waitFor(() => expect(sent('GET', '/api/notifications/count')).toHaveLength(2))
    expect(reads()).toBe(1)
  })

  it('keeps the filter chosen', async () => {
    list = [A, row('RPT-2026-0002', { status: 'archived' })]
    serve()
    await openList()
    await screen.findByText('RPT-2026-0001')
    await poll()
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Archived' }))
    expect(rowOf('RPT-2026-0001')).toBeNull()

    list = [A, row('RPT-2026-0002', { status: 'archived' }), row('RPT-2026-0003')]
    counts = { ...FIRST, inboxTodo: 1 }
    await poll()

    await waitFor(() => expect(reads()).toBe(2))
    expect(rowOf('RPT-2026-0002')).toBeInTheDocument()
    expect(rowOf('RPT-2026-0001')).toBeNull()
    expect(rowOf('RPT-2026-0003')).toBeNull()
  })

  it('waits while hidden and reads once when the tab is shown', async () => {
    serve()
    await openList()
    await screen.findByText('RPT-2026-0001')
    await poll()

    hide(true)
    list = [B]
    counts = { ...FIRST, total: 1 }
    await poll()
    counts = { ...FIRST, total: 2 }
    await poll()
    await waitFor(() => expect(sent('GET', '/api/notifications/count')).toHaveLength(3))
    expect(reads()).toBe(1)
    expect(rowOf('RPT-2026-0001')).toBeInTheDocument()

    hide(false)
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(rowOf('RPT-2026-0001')).toBeNull())
    expect(reads()).toBe(2)
  })

  it('drops a row created in this browser when it moves away too', async () => {
    list = []
    serveCreate()
    await openList()
    await createOne()
    await poll()

    list = []
    counts = { ...FIRST, total: 1, unread: 1 }
    await poll()

    await waitFor(() => expect(rowOf(MADE.reference)).toBeNull())
  })

  it('drops a row created in this browser that moved while you were away', async () => {
    list = []
    serveCreate()
    await openList()
    await createOne()
    await poll()

    await goTo('Inbox')
    list = []
    await goTo('Assessments')

    await waitFor(() => expect(rowOf(MADE.reference)).toBeNull())
  })

  it('never lets a read sent before a create drop the new row', async () => {
    list = []
    let answerRead = () => {}
    let hold = false
    serveCreate({
      'GET /api/assessments': () => {
        if (!hold) return json(200, list)
        hold = false
        return new Promise<Response>((done) => (answerRead = () => done(json(200, []))))
      },
    })
    await openList()
    await screen.findByText('No assessments yet')
    await goTo('Inbox')
    hold = true
    await goTo('Assessments')
    await waitFor(() => expect(hold).toBe(false))

    await createOne()
    await act(async () => answerRead())

    expect(rowOf(MADE.reference)).toBeInTheDocument()
  })

  it('never lets the read on the way back to the list undo a reassign', async () => {
    const moved = { ...A, engineer: OMAR }
    let answerRead = () => {}
    let hold = false
    serve({
      'GET /api/assessments': () => {
        if (!hold) return json(200, list)
        hold = false
        return new Promise<Response>((done) => (answerRead = () => done(json(200, [A, B]))))
      },
      'GET /api/assessments/assignable-engineers': () =>
        json(200, { items: [{ ...OMAR, role: 'knowledge_admin' }] }),
      'POST /api/assessments/RPT-2026-0001/reassign': () => json(200, moved),
    })
    await openList('knowledge_admin')
    await screen.findByText('RPT-2026-0001')
    await goTo('Inbox')
    hold = true
    await goTo('Assessments')
    await waitFor(() => expect(hold).toBe(false))

    fireEvent.click(await screen.findByRole('button', { name: 'Reassign RPT-2026-0001' }))
    const dialog = screen.getByRole('dialog', { name: /^Reassign/ })
    // It starts on the picker: without this the keyboard lands on the X.
    expect(within(dialog).getByRole('button', { name: /^Assigned engineer/ })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    await waitFor(() =>
      expect(within(rowOf('RPT-2026-0001')!).getByText('Omar Khan')).toBeVisible(),
    )

    await act(async () => answerRead())

    expect(within(rowOf('RPT-2026-0001')!).getByText('Omar Khan')).toBeVisible()
  })

  it('never lets a read sent before a reassign put the old engineer back', async () => {
    let answerRead: (reply: Response) => void = () => {}
    const moved = { ...A, engineer: OMAR }
    serve({
      'GET /api/assessments/assignable-engineers': () =>
        json(200, { items: [{ ...OMAR, role: 'knowledge_admin' }] }),
      'POST /api/assessments/RPT-2026-0001/reassign': () => json(200, moved),
    })
    await openList('knowledge_admin')
    await screen.findByText('RPT-2026-0001')
    await poll()

    // A poll finds a change and the list read leaves, but its reply is held back.
    serve({
      'GET /api/assessments': () => new Promise<Response>((done) => (answerRead = done)),
      'GET /api/notifications/count': () => json(200, counts),
      'GET /api/assessments/assignable-engineers': () =>
        json(200, { items: [{ ...OMAR, role: 'knowledge_admin' }] }),
      'POST /api/assessments/RPT-2026-0001/reassign': () => json(200, moved),
    })
    counts = { ...FIRST, inboxTodo: 1 }
    await poll()
    await waitFor(() => expect(reads()).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Reassign RPT-2026-0001' }))
    const dialog = screen.getByRole('dialog', { name: /^Reassign/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    await waitFor(() =>
      expect(within(rowOf('RPT-2026-0001')!).getByText('Omar Khan')).toBeVisible(),
    )

    await act(async () => answerRead(json(200, [A, B])))

    const after = rowOf('RPT-2026-0001')!
    expect(within(after).getByText('Omar Khan')).toBeVisible()
    expect(after).toHaveAttribute('data-changed')
  })

  it('keeps the just-changed tint through a read that follows', async () => {
    const moved = { ...A, engineer: OMAR }
    serve({
      'GET /api/assessments/assignable-engineers': () =>
        json(200, { items: [{ ...OMAR, role: 'knowledge_admin' }] }),
      'POST /api/assessments/RPT-2026-0001/reassign': () => json(200, moved),
    })
    await openList('knowledge_admin')
    await screen.findByText('RPT-2026-0001')
    await poll()

    fireEvent.click(screen.getByRole('button', { name: 'Reassign RPT-2026-0001' }))
    const dialog = screen.getByRole('dialog', { name: /^Reassign/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Assigned engineer/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Omar Khan/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    await waitFor(() => expect(rowOf('RPT-2026-0001')).toHaveAttribute('data-changed'))
    const tinted = rowOf('RPT-2026-0001')

    list = [moved, B]
    counts = { ...FIRST, total: 1 }
    await poll()
    await waitFor(() => expect(reads()).toBe(2))

    expect(rowOf('RPT-2026-0001')).toBe(tinted)
    expect(rowOf('RPT-2026-0001')).toHaveAttribute('data-changed')
  })
})
