// Tests for the Inbox screen (F-10): the whole app rendered at /inbox with the gateway faked,
// as the knowledge request tests do. A person ticks, unticks, bins, opens and undoes, and sees
// the rows, the counts and the toasts that follow. The gateway fake keeps the state a real
// gateway would, so Undo has something to restore.
import { StrictMode } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { signIn } from '../../test/session'
import type { Notification } from '../notifications/api'
import { assessmentOpen } from '../assessments/openAssessment'
import { CountsContext } from '../notifications/useNotificationCounts'
import { formatBellWhen } from '../notifications/formatWhen'
import { useInbox } from './useInbox'

beforeAll(() => {
  // jsdom has no native modal implementation.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const item = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  purpose: 'assessment_assigned',
  kind: 'inbox',
  message: `New assessment: Site ${id}`,
  details: null,
  context: {
    reference: `RPT-${id}`,
    assessmentId: `a${id}`,
    client: `Client ${id}`,
    site: `Site ${id}`,
    sender: 'Sana Patel',
    reportDue: '2030-02-28',
  },
  read: false,
  done: false,
  createdAt: '2026-11-05T03:42:00.000Z',
  ...over,
})

type Stored = Notification & { binned?: boolean }

// One row of the Assessments list as the gateway sends it.
const assessment = (reference: string) => ({
  reference,
  site: { name: `Site ${reference}` },
  client: 'Client',
  surveyType: 'First survey',
  siteVisitDate: '2030-01-15',
  reportDueDate: '2030-02-28',
  engineer: { id: 'u-eng', name: 'Alex Rowe' },
  status: 'not_started',
})

// A gateway that keeps each item's state and answers the Inbox's calls like the real one.
// `refused` names calls that fail ("POST dismiss"); `lists` records each list read's query.
function gateway(seed: Stored[]) {
  const store = seed.map((n) => ({ ...n }))
  const calls: string[] = []
  const refused = new Set<string>()
  const lists: string[] = []
  // The Assessments list; null leaves it unreachable, so the app falls back to its demo rows.
  const assessments: { list: ReturnType<typeof assessment>[] | null } = { list: null }
  // The already-handled check's read calls (F-10 round 3), by path; `readCalls` records them.
  const reads: Record<string, () => Response | Promise<Response>> = {}
  const readCalls: string[] = []
  const todo = () => store.filter((n) => !n.done && !n.binned)
  const respond = (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.split('?')[0]
    if (path === '/api/notifications/count')
      return Response.json({
        total: 0,
        unread: 0,
        inboxTodo: todo().length,
        newestInbox: null,
        newestBell: null,
      })
    if (path === '/api/assessments' && assessments.list) return Response.json(assessments.list)
    if (path === '/api/notifications') {
      lists.push(url.split('?')[1])
      const q = new URLSearchParams(url.split('?')[1])
      const rows = q.get('tab') === 'done' ? store.filter((n) => n.done && !n.binned) : todo()
      const offset = Number(q.get('offset'))
      const limit = Number(q.get('limit'))
      return Response.json({
        items: rows.slice(offset, offset + limit),
        total: rows.length,
        unread: 0,
        inboxTodo: todo().length,
      })
    }
    const [, id, action] = path.match(/^\/api\/notifications\/([^/]+)\/(\w+)$/) ?? []
    const row = store.find((n) => n.id === id)
    if (!row) return null
    calls.push(`${method} ${action} ${id}`)
    if (refused.has(`${method} ${action}`)) return null
    if (action === 'read') row.done = true
    if (action === 'done' && method === 'POST') Object.assign(row, { done: true })
    if (action === 'done' && method === 'DELETE') Object.assign(row, { done: false })
    if (action === 'dismiss') row.binned = true
    if (action === 'restore') row.binned = false
    return new Response(null, { status: 204 })
  }
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const read = reads[url.split('?')[0]]
    if (read) {
      readCalls.push(url)
      // Like the browser's fetch, an aborted read rejects.
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))
        Promise.resolve(read()).then(resolve, reject)
      })
    }
    const response = respond(url, init)
    return response ? Promise.resolve(response) : Promise.reject(new TypeError('Failed to fetch'))
  })
  return { store, calls, refused, lists, assessments, reads, readCalls }
}

// `strict` renders as main.tsx does, in StrictMode, which runs every effect twice in development.
async function openInbox(
  role: 'risk_engineer' | 'knowledge_admin' = 'risk_engineer',
  strict = false,
) {
  window.history.replaceState(null, '', '/inbox')
  render(
    strict ? (
      <StrictMode>
        <App />
      </StrictMode>
    ) : (
      <App />
    ),
  )
  await signIn(role)
}
// The rows of the card on screen. The toasts are list items too, so look inside the card.
const card = () => screen.getByRole('region', { name: /^(To do|Done)$/ })
const rows = () => within(card()).queryAllByRole('listitem')
const sidebarInbox = () =>
  within(screen.getAllByRole('navigation')[0]).getByRole('button', { name: /^Inbox/ })

describe('Inbox screen', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('lists To do items with who sent them, the task, the client and the due date', async () => {
    gateway([item('1'), item('2')])
    await openInbox()
    expect(await screen.findByText('New assessment: Site 1')).toBeVisible()
    expect(screen.getAllByText('Sana Patel')).toHaveLength(2)
    expect(screen.getByText('Client 1')).toBeVisible()
    expect(screen.getAllByText('28 Feb 2030')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'To do, 2' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Done' })).toBeInTheDocument()
  })

  it('counts the To do items on the sidebar, and shows nothing at zero', async () => {
    gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    expect(sidebarInbox()).toHaveTextContent('1 to do')
    fireEvent.click(screen.getByRole('button', { name: /^Mark done/ }))
    await waitFor(() => expect(sidebarInbox()).not.toHaveTextContent('to do'))
  })

  it('shows All done when nothing waits', async () => {
    gateway([])
    await openInbox()
    expect(await screen.findByText('All done')).toBeVisible()
  })

  it('shows a Done tab with nothing in it as "Nothing done yet", with a line of help', async () => {
    gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getByRole('radio', { name: 'Done' }))
    expect(await screen.findByText('Nothing done yet')).toBeVisible()
    expect(screen.getByText('Items you open or tick show up here.')).toBeVisible()
    expect(screen.queryByText('Nothing in Done yet')).toBeNull()
  })

  it('colours a failed document red and one that needs review amber', async () => {
    const doc = (id: string, status: string, details: string | null) =>
      item(id, {
        purpose: 'ingestion_status',
        message: `"Doc ${id}" ${status}.`,
        context: { documentId: `d${id}`, status },
        details,
      })
    gateway([doc('1', 'failed', null), doc('2', 'needs_review', 'Unconfirmed details')])
    await openInbox('knowledge_admin')
    expect(await screen.findByText('Failed to ingest')).toHaveAttribute('data-tone', 'red')
    expect(screen.getByText('Unconfirmed details')).toHaveAttribute('data-tone', 'amber')
  })

  it('ticks a row to Done without opening it, with a toast', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    expect(await screen.findByText('Moved to Done')).toBeVisible()
    expect(gw.calls).toEqual(['POST done 1'])
    // The row closes up after its circle has played.
    await waitFor(() => expect(rows()).toHaveLength(1), { timeout: 3000 })
    expect(screen.getByRole('radio', { name: 'To do, 1' })).toBeInTheDocument()
  })

  it('undoes a tick with an untick, and the row comes back', async () => {
    const gw = gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getByRole('button', { name: /^Mark done/ }))
    await waitFor(() => expect(rows()).toHaveLength(0), { timeout: 3000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('New assessment: Site 1')).toBeVisible()
    expect(gw.calls).toEqual(['POST done 1', 'DELETE done 1'])
  })

  it('unticks a Done row back to To do, with a toast', async () => {
    const gw = gateway([item('1', { done: true })])
    await openInbox()
    fireEvent.click(await screen.findByRole('radio', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Move back to To do/ }))
    expect(await screen.findByText('Moved back to To do')).toBeVisible()
    expect(gw.calls).toEqual(['DELETE done 1'])
    await waitFor(() => expect(rows()).toHaveLength(0), { timeout: 3000 })
  })

  it('undoes an untick of a ticked row by ticking it again', async () => {
    const gw = gateway([item('1', { done: true })])
    await openInbox()
    fireEvent.click(await screen.findByRole('radio', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Move back to To do/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(gw.calls).toEqual(['DELETE done 1', 'POST done 1']))
  })

  it('undoes an untick of a row I only opened by ticking it too', async () => {
    const gw = gateway([item('1', { done: true, read: true })])
    await openInbox()
    fireEvent.click(await screen.findByRole('radio', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Move back to To do/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(gw.calls).toEqual(['DELETE done 1', 'POST done 1']))
  })

  it('bins a row at once and restores it with Undo', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove/ })[0])
    expect(await screen.findByText('Removed from your Inbox')).toBeVisible()
    await waitFor(() => expect(rows()).toHaveLength(1), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(gw.calls).toEqual(['POST dismiss 1', 'POST restore 1'])
  })

  it('opens the item when its row is pressed, and marks it opened', async () => {
    const gw = gateway([item('1')])
    const heard: unknown[] = []
    window.addEventListener(assessmentOpen.event, (e) => heard.push((e as CustomEvent).detail))
    await openInbox()
    fireEvent.click(await screen.findByRole('button', { name: /New assessment: Site 1/ }))
    expect(gw.calls).toEqual(['PATCH read 1'])
    expect(heard).toEqual([{ reference: 'RPT-1' }])
  })

  it('opens a knowledge request on the Requests tab for an admin', async () => {
    gateway([
      item('7', {
        purpose: 'knowledge_gap_request',
        message: 'New knowledge request',
        context: { requestId: 'r7', question: 'Which edition?', askedBy: 'Alex Rowe' },
      }),
    ])
    await openInbox('knowledge_admin')
    fireEvent.click(await screen.findByText('Answer knowledge request'))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
  })

  it('offers Load more when the gateway holds more than the page', async () => {
    gateway(Array.from({ length: 25 }, (_, i) => item(String(i + 1))))
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    expect(rows()).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(rows()).toHaveLength(25))
  })

  it('puts the Inbox first in the sidebar, then Work above Tools, for an admin too', async () => {
    gateway([])
    await openInbox('knowledge_admin')
    await screen.findByText('All done')
    const labels = within(screen.getAllByRole('navigation')[0])
      .getAllByRole('button')
      .map((b) => b.textContent)
    const at = (word: string) => labels.findIndex((l) => l?.startsWith(word))
    expect(at('Inbox')).toBeLessThan(at('Assessments'))
    expect(at('Assessments')).toBeLessThan(at('MarshBot'))
  })

  it('shows an Admin item without a due date', async () => {
    gateway([
      item('9', {
        purpose: 'ingestion_status',
        message: '"NFPA 13-2022" needs review.',
        context: { documentId: 'd9', status: 'needs_review' },
        details: 'Possible newer edition of NFPA_13_2019',
      }),
    ])
    await openInbox('knowledge_admin')
    expect(await screen.findByText('Review document: NFPA 13-2022')).toBeVisible()
    expect(within(card()).getByText('Knowledge base')).toBeVisible()
    expect(screen.queryByText(/Not set/)).toBeNull()
  })
})

describe('Inbox screen: what can go wrong', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('opens a new assignment whose assessment joined the list after it was read', async () => {
    const gw = gateway([item('1')])
    gw.assessments.list = []
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    gw.assessments.list = [assessment('RPT-1')]
    fireEvent.click(screen.getByRole('button', { name: /New assessment: Site 1/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/assessment'))
    expect(window.location.search).toContain('RPT-1')
    expect(gw.calls).toEqual(['PATCH read 1'])
  })

  it.each([
    ['assessment_assigned', {}],
    ['site_walk_ready', { walkId: 'w1' }],
  ] as const)(
    'says so and keeps a %s row in To do when its assessment still cannot be found',
    async (purpose, extra) => {
      const gw = gateway([item('1', { purpose, context: { reference: 'RPT-1', ...extra } })])
      gw.assessments.list = []
      await openInbox()
      const row = await screen.findByRole('button', { name: /New assessment: Site 1/ })
      fireEvent.click(row)
      expect(await screen.findByText('Assessment not found')).toBeVisible()
      await waitFor(() => expect(gw.calls).toEqual(['PATCH read 1', 'DELETE done 1']))
      expect(gw.store[0].done).toBe(false)
      expect(await screen.findByRole('radio', { name: 'To do, 1' })).toBeInTheDocument()
      expect(window.location.pathname).toBe('/inbox')
    },
  )

  it('shows a row plainly in Done when the tab changes while its tick plays', async () => {
    gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    fireEvent.click(screen.getByRole('radio', { name: /^Done/ }))
    const row = (await screen.findByText('New assessment: Site 1')).closest('li')!
    expect(row).not.toHaveAttribute('data-phase')
    // The tick's timers would have closed the row by now.
    await act(() => new Promise((done) => setTimeout(done, 900)))
    expect(screen.getByText('New assessment: Site 1')).toBeVisible()
  })

  it('moves the keyboard to the row that takes the place of one that left', async () => {
    gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const tick = screen.getAllByRole('button', { name: /^Mark done/ })[0]
    tick.focus()
    fireEvent.click(tick)
    await waitFor(() => expect(screen.queryByText('New assessment: Site 1')).toBeNull(), {
      timeout: 2000,
    })
    expect(screen.getByText('New assessment: Site 2').closest('button')).toHaveFocus()
  })

  it('moves the keyboard to the tabs when the last row leaves', async () => {
    gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const tick = screen.getByRole('button', { name: /^Mark done/ })
    tick.focus()
    fireEvent.click(tick)
    await screen.findByText('All done', { selector: '.inbox-empty p' }, { timeout: 2000 })
    expect(screen.getByRole('radio', { name: /^To do/ })).toHaveFocus()
  })

  it('leaves the focus alone when a row leaves while the person is elsewhere', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const tab = screen.getByRole('radio', { name: /^To do/ })
    tab.focus()
    gw.store[0].done = true
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.queryByText('New assessment: Site 1')).toBeNull())
    expect(tab).toHaveFocus()
  })

  it('tells a screen reader when the last row has gone', async () => {
    gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getByRole('button', { name: /^Mark done/ }))
    expect(
      await screen.findByText(
        'Nothing left in To do',
        { selector: '[role="status"]' },
        { timeout: 2000 },
      ),
    ).toBeInTheDocument()
  })

  it('stays quiet about an empty list while rows are left', async () => {
    gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    await waitFor(() => expect(screen.queryByText('New assessment: Site 1')).toBeNull(), {
      timeout: 2000,
    })
    expect(screen.getByRole('status', { hidden: true })).not.toHaveTextContent('Nothing left')
  })

  it('drops a row ticked in another tab from an open To do list', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    gw.store[0].done = true
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.queryByText('New assessment: Site 1')).toBeNull())
    expect(screen.getByText('New assessment: Site 2')).toBeVisible()
  })

  it('drops a row someone else unticked from an open Done list', async () => {
    const gw = gateway([item('1', { done: true }), item('2')])
    await openInbox()
    fireEvent.click(await screen.findByRole('radio', { name: /^Done/ }))
    await screen.findByText('New assessment: Site 1')
    gw.store[0].done = false
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.queryByText('New assessment: Site 1')).toBeNull())
  })

  it('does not read the list again for your own tick', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const before = gw.lists.length
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    await screen.findByText('Moved to Done')
    document.dispatchEvent(new Event('visibilitychange'))
    await act(() => new Promise((done) => setTimeout(done, 50)))
    expect(gw.lists.length).toBe(before)
  })

  it('ignores a Load more that answers after the tab changed', async () => {
    const gw = gateway([
      ...Array.from({ length: 25 }, (_, i) => item(String(i + 1))),
      item('D', { done: true, message: 'Already done' }),
    ])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const real = globalThis.fetch
    let answer = () => {}
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('offset=20')
        ? new Promise((done) => (answer = () => done(real(url, init))))
        : real(url, init),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('radio', { name: /^Done/ }))
    await screen.findByText('Already done')
    await act(async () => answer())
    await act(() => new Promise((done) => setTimeout(done, 20)))
    expect(rows()).toHaveLength(1)
    expect(gw.lists.some((q) => q.includes('offset=20'))).toBe(true)
  })

  it('counts Load more from the rows still on the server, not the ones leaving', async () => {
    const gw = gateway(Array.from({ length: 25 }, (_, i) => item(String(i + 1))))
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(gw.lists.at(-1)).toContain('offset=19'))
  })

  // Holds list reads back: each reply is the gateway's state when it was sent, delivered by `answer`.
  const holdListReads = () => {
    const real = globalThis.fetch
    const held = { answer: () => {} }
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (!url.startsWith('/api/notifications?')) return real(url, init)
      const reply = real(url, init)
      return new Promise((done) => (held.answer = () => done(reply)))
    })
    return held
  }
  const pollNow = () => document.dispatchEvent(new Event('visibilitychange'))
  const leftTheList = (text: string) =>
    waitFor(() => expect(screen.queryByText(text)).toBeNull(), { timeout: 2000 })

  it('brings back a row unticked in another tab after you ticked it', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    await leftTheList('New assessment: Site 1')
    gw.store[0].done = false
    pollNow()
    expect(await screen.findByText('New assessment: Site 1')).toBeVisible()
  })

  it('keeps a reply sent before your tick from undoing it', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    const held = holdListReads()
    const before = gw.lists.length
    gw.store.unshift(item('3'))
    pollNow()
    await waitFor(() => expect(gw.lists.length).toBe(before + 1))
    await waitFor(() => expect(sidebarInbox()).toHaveTextContent('3 to do'))

    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    await leftTheList('New assessment: Site 1')
    await act(async () => held.answer())

    expect(await screen.findByText('New assessment: Site 3')).toBeVisible()
    expect(screen.queryByText('New assessment: Site 1')).toBeNull()
    expect(sidebarInbox()).toHaveTextContent('2 to do')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('keeps Load more on offer when a read lands while a row is leaving', async () => {
    const gw = gateway(Array.from({ length: 21 }, (_, i) => item(String(i + 1))))
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    await screen.findByText('Moved to Done')
    const before = gw.lists.length
    gw.store.unshift(item('N'))
    pollNow()
    await waitFor(() => expect(gw.lists.length).toBe(before + 1))
    await screen.findByText('New assessment: Site N')
    await leftTheList('New assessment: Site 1')
    expect(rows()).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'Load more' })).toBeVisible()
  })

  it('keeps every row Load more brought when the list is read again', async () => {
    const gw = gateway([
      ...Array.from({ length: 25 }, (_, i) => item(String(i + 1))),
      item('D', { done: true, message: 'Already done' }),
    ])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(rows()).toHaveLength(25))
    gw.store.unshift(item('N'))
    pollNow()
    await screen.findByText('New assessment: Site N')
    expect(gw.lists.at(-1)).toContain('limit=25')
    expect(rows()).toHaveLength(25)

    // A tab switch starts over with one page.
    fireEvent.click(screen.getByRole('radio', { name: /^Done/ }))
    await screen.findByText('Already done')
    expect(gw.lists.at(-1)).toContain('limit=20')
  })

  it('brings a row back when a bin fails on the Done tab', async () => {
    gateway([item('1', { done: true })])
    await openInbox()
    fireEvent.click(await screen.findByRole('radio', { name: /^Done/ }))
    const bin = await screen.findByRole('button', { name: /^Remove/ })
    // The refusal lands after the row has closed up (180 ms).
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.endsWith('/dismiss')
        ? new Promise((_, refuse) => setTimeout(() => refuse(new TypeError('down')), 300))
        : real(url, init),
    )
    fireEvent.click(bin)
    await waitFor(() => expect(rows()).toHaveLength(0))
    expect(await screen.findByText("Couldn't update")).toBeVisible()
    expect(await screen.findByText('New assessment: Site 1')).toBeVisible()
    expect(rows()).toHaveLength(1)
  })

  it('says so and reads the list again when Undo fails', async () => {
    const gw = gateway([item('1'), item('2')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    fireEvent.click(screen.getAllByRole('button', { name: /^Mark done/ })[0])
    const undo = await screen.findByRole('button', { name: 'Undo' })
    gw.refused.add('DELETE done')
    const reads = gw.lists.length
    fireEvent.click(undo)
    expect(await screen.findByText("Couldn't undo")).toBeVisible()
    await waitFor(() => expect(gw.lists.length).toBeGreaterThan(reads))
  })

  it('puts the count back when opening a row fails', async () => {
    const gw = gateway([
      item('1', { purpose: 'account_status', message: 'Your account changed', context: null }),
    ])
    gw.refused.add('PATCH read')
    await openInbox()
    fireEvent.click(await screen.findByText('Your account changed'))
    await waitFor(() => expect(gw.calls).toEqual(['PATCH read 1']))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'To do, 1' })).toBeInTheDocument())
  })

  it('caps the To do tab count at 99+, as the sidebar and bell do', async () => {
    gateway(Array.from({ length: 1000 }, (_, i) => item(String(i + 1))))
    await openInbox()
    const tab = await screen.findByRole('radio', { name: 'To do, 1000' })
    expect(tab).toHaveTextContent('99+')
  })

  it('names the tick by what it does, with no pressed state on top', async () => {
    gateway([item('1')])
    await openInbox()
    const tick = await screen.findByRole('button', { name: /^Mark done/ })
    expect(tick).not.toHaveAttribute('aria-pressed')
  })
})

// The refetch rule on its own: while the tab is hidden a change waits, because the list route
// refreshes the session cookie. Rendered with the counts provider's value, so a test decides.
describe('useInbox: changes from outside', () => {
  const page = { items: [], total: 0, unread: 0, inboxTodo: 0 }
  const hide = (hidden: boolean) =>
    Object.defineProperty(document, 'visibilityState', {
      value: hidden ? 'hidden' : 'visible',
      configurable: true,
    })
  afterEach(() => hide(false))

  it('waits while hidden and reads the list once when the tab is shown again', async () => {
    const reads = vi.fn(() => Promise.resolve(Response.json(page)))
    vi.stubGlobal('fetch', reads)
    let outsideChanges = 0
    const { rerender } = renderHook(() => useInbox(), {
      wrapper: ({ children }) => (
        <CountsContext.Provider
          value={{
            counts: { total: 0, unread: 0, inboxTodo: 0 },
            change: () => undefined,
            outsideChanges,
          }}
        >
          {children}
        </CountsContext.Provider>
      ),
    })
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(1))

    hide(true)
    outsideChanges = 1
    rerender()
    outsideChanges = 2
    rerender()
    await act(() => new Promise((done) => setTimeout(done, 10)))
    expect(reads).toHaveBeenCalledTimes(1)

    hide(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    document.dispatchEvent(new Event('visibilitychange'))
    await act(() => new Promise((done) => setTimeout(done, 10)))
    expect(reads).toHaveBeenCalledTimes(2)
  })
})

describe('Inbox screen: arrivals, Back and the phone', () => {
  const request = (id: string) =>
    item(id, {
      purpose: 'knowledge_gap_request',
      message: 'New knowledge request',
      context: { requestId: `r${id}`, question: `Question ${id}?`, askedBy: 'Alex Rowe' },
    })

  it('adds a new item that arrives while the Inbox is open, with the fresh tint', async () => {
    const gw = gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    gw.store.unshift({ ...item('2') })
    // The tab is shown again: the count is read at once, and its rise reads the list again.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await screen.findByText('New assessment: Site 2')).toBeVisible()
    expect(screen.getByText('New assessment: Site 2').closest('li')).toHaveAttribute('data-fresh')
    expect(screen.getByText('New assessment: Site 1').closest('li')).not.toHaveAttribute(
      'data-fresh',
    )
  })

  it('tells a screen reader when an item arrives while the Inbox is open', async () => {
    const gw = gateway([item('1')])
    await openInbox()
    await screen.findByText('New assessment: Site 1')
    gw.store.unshift({ ...item('2') })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(
      await screen.findByText('New in To do: 1', { selector: '[role="status"]' }),
    ).toBeInTheDocument()
  })

  it('shows an opened row ticked and then leaving when you come back with Back', async () => {
    gateway([request('1'), request('2')])
    await openInbox('knowledge_admin', true)
    fireEvent.click((await screen.findAllByText('Answer knowledge request'))[0])
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/inbox'))
    const ticked = await waitFor(() => {
      const el = card().querySelector('li[data-phase]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(ticked).toHaveAttribute('data-done')
    await waitFor(() => expect(rows()).toHaveLength(1), { timeout: 3000 })
  })

  it('shows the row already gone when you arrive at the Inbox any other way', async () => {
    gateway([request('1'), request('2')])
    await openInbox('knowledge_admin')
    fireEvent.click((await screen.findAllByText('Answer knowledge request'))[0])
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    fireEvent.click(sidebarInbox())
    await screen.findByRole('region', { name: 'To do' })
    expect(rows()).toHaveLength(1)
    expect(card().querySelector('li[data-phase]')).toBeNull()
  })

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width: 767px'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }))
    })

    it('shows the due date alone on the right of a To do row, with no arrival time', async () => {
      gateway([
        item('1'),
        item('2', { purpose: 'knowledge_gap_request', context: { question: 'Q?' } }),
      ])
      await openInbox()
      await screen.findByText('Site 1')
      // The app's two-line date cell: date, then days left. No arrival time anywhere.
      expect(screen.getAllByText('28 Feb 2030')).toHaveLength(1)
      expect(screen.getByText(/^in \d+ days$/)).toBeVisible()
      expect(card().querySelector('time')).toBeNull()
    })

    it('shows nothing on the right of an assessment that has no report due date', async () => {
      const context = { ...item('1').context! }
      delete context.reportDue
      gateway([item('1', { context })])
      await openInbox()
      await screen.findByText('Site 1')
      expect(screen.queryByText('Not set')).toBeNull()
    })

    it('shows the bin alone on the right of a Done row, with no arrival time', async () => {
      gateway([item('1', { done: true })])
      await openInbox()
      fireEvent.click(await screen.findByRole('radio', { name: 'Done' }))
      expect(await screen.findByRole('button', { name: /^Remove/ })).toBeVisible()
      expect(card().querySelector('time')).toBeNull()
    })

    it('shows only the title, a ring that ticks, and a bin on Done rows only', async () => {
      const gw = gateway([item('1'), item('2', { done: true })])
      await openInbox()
      await screen.findByText('New assessment')
      expect(screen.queryByText(/Work that needs you/)).toBeNull()
      expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
      // The row has two lines: the task name, then the site.
      expect(screen.getByText('Site 1')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: /^Mark done/ }))
      expect(gw.calls).toEqual(['POST done 1'])
      fireEvent.click(screen.getByRole('radio', { name: 'Done' }))
      // Two: the Done row, and the one just ticked, which stays once the tab has changed.
      expect(await screen.findAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
    })
  })
})

// F-10 round 3: a To do row first asks whether someone already dealt with it.
describe('Inbox screen: already handled', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.useRealTimers())

  const SANA = '6ab39017e45cf009e4507734'
  const at = '2026-11-03T07:10:00.000Z'
  const request = (over: Partial<Notification> = {}) =>
    item('1', {
      purpose: 'knowledge_gap_request',
      message: 'New knowledge request',
      context: { requestId: 'r1', question: 'Which edition?', askedBy: 'Alex Rowe' },
      ...over,
    })
  const filled = (by: { id: string; name: string } | null = { id: 'u9', name: 'Omar Khan' }) =>
    Response.json({ status: 'filled', closed: by && { at, by } })
  const press = async () => fireEvent.click(await screen.findByText('Answer knowledge request'))
  const dialog = (name: string) => screen.findByRole('dialog', { name })

  it('shows who filled a request and when, and opens nothing', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled()
    await openInbox('knowledge_admin')
    await press()
    const d = await dialog('Request already filled')
    expect(d).toHaveTextContent('Omar Khan')
    expect(d).toHaveTextContent(formatBellWhen(at))
    expect(window.location.pathname).toBe('/inbox')
    expect(gw.calls).toEqual([])
    expect(gw.readCalls).toEqual(['/api/knowledge-gaps/r1'])
    expect(sidebarInbox()).toHaveTextContent('1 to do')
  })

  it('shows a retried document with its name', async () => {
    const gw = gateway([
      item('1', {
        purpose: 'ingestion_status',
        message: '"Cold Store" failed.',
        context: { documentId: 'd1', status: 'failed' },
      }),
    ])
    gw.reads['/api/knowledge-documents/d1'] = () =>
      Response.json({
        status: 'complete',
        withdrawn: null,
        handled: { at, by: { id: 'u9', name: 'Omar Khan' } },
        unconfirmed: [],
        match: null,
      })
    await openInbox('knowledge_admin')
    fireEvent.click(await screen.findByText('Failed to ingest'))
    expect(await dialog('Document already retried')).toHaveTextContent('Omar Khan')
  })

  it('reads "You" for my own action', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled({ id: SANA, name: 'Sana Patel' })
    await openInbox('knowledge_admin')
    await press()
    const d = await dialog('Request already filled')
    expect(d).toHaveTextContent('You')
    expect(d).not.toHaveTextContent('Sana Patel')
  })

  it('has no who line when no name is known', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled(null)
    await openInbox('knowledge_admin')
    await press()
    const d = await dialog('Request already filled')
    expect(d).not.toHaveAttribute('aria-describedby')
    expect(within(d).queryByRole('time')).toBeNull()
    expect(within(d).getByRole('button', { name: 'Move to Done' })).toBeVisible()
  })

  it('has no way out but Move to Done, which gets the focus', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled()
    await openInbox('knowledge_admin')
    await press()
    const d = await dialog('Request already filled')
    expect(within(d).queryByRole('button', { name: 'Close' })).toBeNull()
    expect(within(d).getByRole('button', { name: 'Move to Done' })).toHaveFocus()
  })

  it('ticks only after the dialog has closed, with no toast', async () => {
    const gw = gateway([request(), item('2')])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled()
    await openInbox('knowledge_admin')
    await press()
    fireEvent.click(
      within(await dialog('Request already filled')).getByRole('button', { name: 'Move to Done' }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(gw.calls).toEqual([])
    await waitFor(() => expect(gw.calls).toEqual(['POST done 1']))
    await waitFor(() => expect(sidebarInbox()).toHaveTextContent('1 to do'))
    expect(screen.queryByText('Moved to Done')).toBeNull()
    expect(gw.calls).not.toContain('PATCH read 1')
  })

  it('shows the error when the tick fails', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => filled()
    gw.refused.add('POST done')
    await openInbox('knowledge_admin')
    await press()
    fireEvent.click(
      within(await dialog('Request already filled')).getByRole('button', { name: 'Move to Done' }),
    )
    expect(await screen.findByText("Couldn't update")).toBeVisible()
  })

  it('opens the row as usual when the check fails', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => new Response(null, { status: 500 })
    await openInbox('knowledge_admin')
    await press()
    await waitFor(() => expect(window.location.pathname).toBe('/admin/knowledge-base'))
    expect(gw.calls).toEqual(['PATCH read 1'])
  })

  it('opens the row as usual when the check takes over 3 s', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => new Promise<Response>(() => {})
    await openInbox('knowledge_admin')
    const row = await screen.findByText('Answer knowledge request')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(row)
    await act(() => vi.advanceTimersByTimeAsync(2900))
    expect(window.location.pathname).toBe('/inbox')
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(window.location.pathname).toBe('/admin/knowledge-base')
    expect(gw.calls).toEqual(['PATCH read 1'])
  })

  it('ignores a second press while the check runs', async () => {
    const gw = gateway([request()])
    gw.reads['/api/knowledge-gaps/r1'] = () => new Promise<Response>(() => {})
    await openInbox('knowledge_admin')
    const row = await screen.findByText('Answer knowledge request')
    fireEvent.click(row)
    fireEvent.click(row)
    expect(gw.readCalls).toHaveLength(1)
  })

  it('neither opens the row nor shows the dialog once it was ticked during the check', async () => {
    const gw = gateway([request()])
    let answer = () => {}
    gw.reads['/api/knowledge-gaps/r1'] = () =>
      new Promise<Response>(
        (resolve) => (answer = () => resolve(Response.json({ status: 'filled', closed: null }))),
      )
    await openInbox('knowledge_admin')
    await press()
    await waitFor(() => expect(gw.readCalls).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /^Mark done/ }))
    answer()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/inbox')
  })

  it('forgets the check when the tab changes', async () => {
    const gw = gateway([request()])
    let answer = () => {}
    gw.reads['/api/knowledge-gaps/r1'] = () =>
      new Promise<Response>(
        (resolve) => (answer = () => resolve(Response.json({ status: 'filled', closed: null }))),
      )
    await openInbox('knowledge_admin')
    await press()
    await waitFor(() => expect(gw.readCalls).toHaveLength(1))
    fireEvent.click(screen.getByRole('radio', { name: /^Done/ }))
    answer()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/inbox')
  })

  it('forgets the check when another row is opened', async () => {
    const gw = gateway([request(), item('2')])
    let answer = () => {}
    gw.reads['/api/knowledge-gaps/r1'] = () =>
      new Promise<Response>(
        (resolve) => (answer = () => resolve(Response.json({ status: 'filled', closed: null }))),
      )
    await openInbox('knowledge_admin')
    await press()
    await waitFor(() => expect(gw.readCalls).toHaveLength(1))
    fireEvent.click(await screen.findByText('New assessment: Site 2'))
    answer()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not navigate when the screen is left during the check', async () => {
    const gw = gateway([request()])
    let answer = () => {}
    gw.reads['/api/knowledge-gaps/r1'] = () =>
      new Promise<Response>(
        (resolve) => (answer = () => resolve(Response.json({ status: 'open' }))),
      )
    await openInbox('knowledge_admin')
    await press()
    await waitFor(() => expect(gw.readCalls).toHaveLength(1))
    cleanup()
    answer()
    await new Promise((r) => setTimeout(r, 20))
    expect(window.location.pathname).toBe('/inbox')
    expect(gw.calls).toEqual([])
  })

  it('makes no check for Done rows or assessment rows', async () => {
    const gw = gateway([item('1'), request({ id: '2', done: true })])
    await openInbox('knowledge_admin')
    fireEvent.click(await screen.findByRole('button', { name: /New assessment: Site 1/ }))
    expect(gw.readCalls).toEqual([])
    cleanup()
    const gw2 = gateway([request({ done: true })])
    await openInbox('knowledge_admin')
    fireEvent.click(await screen.findByRole('radio', { name: 'Done' }))
    fireEvent.click(await screen.findByText('Answer knowledge request'))
    expect(gw2.readCalls).toEqual([])
  })
})
