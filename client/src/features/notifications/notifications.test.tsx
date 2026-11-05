import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell, type NotificationBellProps } from './NotificationBell'
import { NotificationCountsProvider } from './NotificationCountsContext'
import type { Notification, NotificationPage } from './api'
import { knowledgeTab } from '../knowledge-base/openTab'
import { toneFor } from './components/notificationTone'

afterEach(cleanup)

// The bell on its shared counts, as App.tsx mounts it.
function Bell({
  counts,
  ...props
}: NotificationBellProps & { counts: { total: number; unread: number } }) {
  return (
    <NotificationCountsProvider initial={{ inboxTodo: 0, ...counts }}>
      <NotificationBell {...props} />
    </NotificationCountsProvider>
  )
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const noContent = () => Promise.resolve(new Response(null, { status: 204 }))

// Builds `count` notifications, newest first (id n1 is newest), all unread.
function makeItems(count: number, startAt = 1): Notification[] {
  return Array.from({ length: count }, (_, i) => {
    const n = startAt + i
    return {
      id: `n${n}`,
      purpose: 'ingestion_status' as const,
      kind: 'bell' as const,
      message: `Document ${n} failed to ingest.`,
      details: null,
      context: null,
      read: false,
      done: false,
      doneAt: null,
      createdAt: '2026-04-11T09:22:00.000Z',
    }
  })
}

// Serves notification pages from a fixed list, honouring limit/offset, and
// records calls so a test can assert what the gateway was asked.
function stubGateway(all: Notification[], unread = all.length) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/notifications/count')) {
      return json({ total: all.length, unread })
    }
    if (url.includes('/api/notifications?')) {
      const params = new URLSearchParams(url.split('?')[1])
      const limit = Number(params.get('limit'))
      const offset = Number(params.get('offset'))
      const page: NotificationPage = {
        items: all.slice(offset, offset + limit),
        total: all.length,
        unread,
        inboxTodo: 0,
      }
      return json(page)
    }
    if (method !== 'GET') return noContent()
    return json({ items: [], total: 0, unread: 0 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('NotificationBell', () => {
  it('shows the unread count from the session on the bell', () => {
    stubGateway(makeItems(3))
    render(<Bell counts={{ total: 3, unread: 3 }} />)
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows no count when nothing is unread', () => {
    stubGateway([], 0)
    render(<Bell counts={{ total: 0, unread: 0 }} />)
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('opens the dropdown and loads the first page', async () => {
    stubGateway(makeItems(3))
    render(<Bell counts={{ total: 3, unread: 3 }} pageSize={5} />)

    open()

    expect(await screen.findByText('Document 1 failed to ingest.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('renders exactly pageSize rows, and a different pageSize changes that', async () => {
    stubGateway(makeItems(10))
    const { unmount } = render(<Bell counts={{ total: 10, unread: 10 }} pageSize={3} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    unmount()

    stubGateway(makeItems(10))
    render(<Bell counts={{ total: 10, unread: 10 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('offers Load more while fewer than the total are loaded, and appends the next page', async () => {
    stubGateway(makeItems(5))
    render(<Bell counts={{ total: 5, unread: 5 }} pageSize={2} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    // No duplicates: each message appears once.
    expect(screen.getByText('Document 1 failed to ingest.')).toBeInTheDocument()
    expect(screen.getByText('Document 3 failed to ingest.')).toBeInTheDocument()
  })

  it('hides Load more once every notification is loaded', async () => {
    stubGateway(makeItems(2))
    render(<Bell counts={{ total: 2, unread: 2 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('marks one read, dropping the unread count but keeping the row', async () => {
    stubGateway(makeItems(2))
    render(<Bell counts={{ total: 2, unread: 2 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    const firstRow = screen.getAllByRole('listitem')[0]
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Mark as read' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument(),
    )
    expect(screen.getByText('Document 1 failed to ingest.')).toBeInTheDocument()
  })

  it('marks all read: badge clears, rows stay', async () => {
    stubGateway(makeItems(3))
    render(<Bell counts={{ total: 3, unread: 3 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument(),
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('hides Mark all as read when nothing is unread', async () => {
    stubGateway(makeItems(2), 0)
    const items = makeItems(2).map((n) => ({ ...n, read: true }))
    stubGateway(items, 0)
    render(<Bell counts={{ total: 2, unread: 0 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('dismisses all: empties the list and hides Load more', async () => {
    stubGateway(makeItems(5))
    render(<Bell counts={{ total: 5, unread: 5 }} pageSize={2} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))

    await screen.findByText('No notifications')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('dismisses one row: removes it, drops the counts, and calls the gateway', async () => {
    const fetchMock = stubGateway(makeItems(2))
    render(<Bell counts={{ total: 2, unread: 2 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    const firstRow = screen.getAllByRole('listitem')[0]
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.queryByText('Document 1 failed to ingest.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/n1/dismiss', { method: 'POST' })
  })

  it('does not lower the unread count when a read row is dismissed', async () => {
    const items = makeItems(2).map((n, i) => ({ ...n, read: i === 0 }))
    stubGateway(items, 1)
    render(<Bell counts={{ total: 2, unread: 1 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    const firstRow = screen.getAllByRole('listitem')[0]
    expect(within(firstRow).queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument()
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('pulses the badge only when the count rises after the first load', async () => {
    stubGateway(makeItems(1), 1)
    render(<Bell counts={{ total: 1, unread: 1 }} />)
    expect(document.querySelector('.notif-bell--ring')).toBeNull()
    // The count is polled into the hook, not the prop, so drive it with the poll.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json({ total: 2, unread: 2 })),
    )
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument(),
    )
    await waitFor(() => expect(document.querySelector('.notif-bell--ring')).not.toBeNull())
  })

  it('expands a long message in place', async () => {
    const items = makeItems(1)
    items[0].details = 'Processing stopped on a system error.\nUpload the document again.'
    stubGateway(items)
    render(<Bell counts={{ total: 1, unread: 1 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')
    // Collapsed, one line (board 11): the first line of the details beside the time.
    expect(screen.getByText(/· Processing stopped on a system error\.$/)).toBeInTheDocument()
    expect(screen.queryByText(/Upload the document again/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(screen.getByText(/Upload the document again/)).toBeInTheDocument()
  })

  it('offers no Show more when the one line says it all', async () => {
    const items = makeItems(1)
    items[0].details = 'Already covered by FM 8-1'
    stubGateway(items)
    render(<Bell counts={{ total: 1, unread: 1 }} pageSize={5} />)
    open()
    expect(await screen.findByText(/· Already covered by FM 8-1$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('says who moved an assessment away, as drawn on board 11', async () => {
    stubGateway([
      {
        ...makeItems(1)[0],
        purpose: 'assessment_moved',
        message: 'RPT-2026-0002 moved to Jordan Lee',
        context: { reference: 'RPT-2026-0002', sender: 'Sana Patel' },
      },
    ])
    render(<Bell counts={{ total: 1, unread: 1 }} pageSize={5} />)
    open()
    expect(await screen.findByText(/· Sana Patel reassigned it$/)).toBeInTheDocument()
  })

  it('shows an error with a next step when the gateway fails, without blanking', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('network down')))
    vi.stubGlobal('fetch', fetchMock)
    render(<Bell counts={{ total: 2, unread: 2 }} pageSize={5} />)

    open()

    expect(await screen.findByText('Notifications not loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no notifications', async () => {
    stubGateway([], 0)
    render(<Bell counts={{ total: 0, unread: 0 }} pageSize={5} />)
    open()
    expect(await screen.findByText('No notifications')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    stubGateway(makeItems(2))
    render(<Bell counts={{ total: 2, unread: 2 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Document 1 failed to ingest.')).not.toBeInTheDocument()
  })

  // F-10 restyle (board 11): Esc, a press outside or the phone sheet closes it, so there is no ×.
  it('has no close button', async () => {
    stubGateway(makeItems(1))
    render(<Bell counts={{ total: 1, unread: 1 }} pageSize={5} />)
    open()
    await screen.findByText('Document 1 failed to ingest.')

    expect(screen.queryByRole('button', { name: 'Close notifications' })).not.toBeInTheDocument()
  })

  it('updates the badge from the count poll without a reload', async () => {
    vi.useFakeTimers()
    try {
      // Start with nothing unread, then the gateway reports two.
      stubGateway(makeItems(2), 2)
      render(<Bell counts={{ total: 0, unread: 0 }} pageSize={5} />)
      expect(screen.queryByText('2')).not.toBeInTheDocument()

      // One poll interval later, the badge reflects the gateway's count — the
      // dropdown was never opened. Advancing inside act() lets the state update
      // from the resolved count fetch flush before the assertion.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

// IN-07: a document that needs review opens its Review page from the bell.
describe('NotificationBell — needs review', () => {
  it("opens the document's Review page when its notification is clicked", async () => {
    const item: Notification = {
      ...makeItems(1)[0],
      message: '"NFPA 13" needs review.',
      context: { documentId: 'doc1', status: 'needs_review' },
    }
    stubGateway([item])
    const followed = vi.fn()
    window.addEventListener('popstate', followed)
    render(<Bell counts={{ total: 1, unread: 1 }} />)

    open()
    fireEvent.click(await screen.findByRole('button', { name: '"NFPA 13" needs review.' }))

    expect(window.location.pathname).toBe('/admin/knowledge-base/review/doc1')
    // The app and the knowledge base follow the URL on popstate.
    expect(followed).toHaveBeenCalled()
    window.removeEventListener('popstate', followed)
    window.history.replaceState(null, '', '/')
  })
})

// CB-07: a knowledge request's notification opens Requests for an admin, the chat for the asker.
describe('NotificationBell — knowledge requests', () => {
  it.each([
    ['New knowledge request', { requestId: 'r1' }, '/admin/knowledge-base', 'requests'],
    [
      'Your knowledge request was filled',
      { requestId: 'r1', status: 'filled' },
      '/ask',
      'documents',
    ],
  ])('opens the right screen for "%s"', async (message, context, path, tab) => {
    stubGateway([{ ...makeItems(1)[0], purpose: 'knowledge_gap_request', message, context }])
    render(<Bell counts={{ total: 1, unread: 1 }} />)

    open()
    fireEvent.click(await screen.findByRole('button', { name: message }))

    expect(window.location.pathname).toBe(path)
    expect(knowledgeTab.current).toBe(tab)
    window.history.replaceState(null, '', '/')
    knowledgeTab.current = 'documents'
  })
})

// CB-07: a knowledge request opens the Requests tab for an admin, and the chat for an engineer.
describe('NotificationBell — knowledge requests', () => {
  const click = async (context: Record<string, string>, message: string) => {
    stubGateway([{ ...makeItems(1)[0], purpose: 'knowledge_gap_request', message, context }])
    render(<Bell counts={{ total: 1, unread: 1 }} />)
    open()
    fireEvent.click(await screen.findByRole('button', { name: message }))
  }
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('opens Requests for a new request', async () => {
    await click({ requestId: 'r1' }, 'New knowledge request')
    expect(window.location.pathname).toBe('/admin/knowledge-base')
  })

  it('opens the chat for the engineer when a request is closed', async () => {
    await click({ requestId: 'r1', status: 'filled' }, 'Your knowledge request was filled')
    expect(window.location.pathname).toBe('/ask')
  })
})

// CB-07: an expanded knowledge request shows its parts under labels, not one block of text.
describe('NotificationBell — knowledge request details', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('shows the question, the documents added and Ask again for a filled request', async () => {
    const context = {
      requestId: 'r1',
      status: 'filled',
      question: 'Lithium-ion storage?',
      documents: JSON.stringify([{ title: 'FM 8-1', uploadedAt: '2026-10-20T08:00:00.000Z' }]),
    }
    const message = 'Your knowledge request was filled'
    stubGateway([
      { ...makeItems(1)[0], purpose: 'knowledge_gap_request', message, details: 'x', context },
    ])
    render(<Bell counts={{ total: 1, unread: 1 }} />)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument()
    expect(screen.getByText('Lithium-ion storage?')).toBeInTheDocument()
    expect(screen.getByText('FM 8-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }))
    expect(window.location.pathname).toBe('/ask')
  })

  it('opens the request itself from Go to request', async () => {
    const context = { requestId: 'r7', question: 'Q?', askedBy: 'Alex Rowe', message: 'FM 8-1' }
    const message = 'New knowledge request'
    stubGateway([
      { ...makeItems(1)[0], purpose: 'knowledge_gap_request', message, details: 'x', context },
    ])
    render(<Bell counts={{ total: 1, unread: 1 }} />)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    expect(screen.getByRole('heading', { name: 'Message from Alex Rowe' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to request' }))
    expect(knowledgeTab.request).toBe('r7')
    knowledgeTab.current = 'documents'
    knowledgeTab.request = null
  })
})

// CB-07 UI polish: each purpose has its own glyph, coloured by status; the header is one row.
describe('NotificationBell — icons and header', () => {
  it('colours by status: red, amber, green, graphite, else navy', () => {
    expect(toneFor('failed').fg).toContain('critical')
    expect(toneFor('needs_review').fg).toContain('moderate')
    expect(toneFor('filled').fg).toContain('low')
    expect(toneFor('dismissed').fg).toContain('text-secondary')
    expect(toneFor(undefined).fg).toBe('var(--ink-600)')
  })

  it('shows a different glyph for each purpose', async () => {
    const purposes = ['ingestion_status', 'transcription_status', 'knowledge_gap_request'] as const
    stubGateway(purposes.map((purpose, i) => ({ ...makeItems(1, i + 1)[0], purpose })))
    render(<Bell counts={{ total: 3, unread: 3 }} />)
    open()
    await screen.findAllByRole('listitem')
    const srcs = [...document.querySelectorAll('.notif-icon')].map((el) =>
      el.getAttribute('data-icon'),
    )
    expect(new Set(srcs).size).toBe(3)
  })

  // F-10 restyle (board 11): a thin header with the title and two buttons; no "N unread" text.
  it('keeps the title and two buttons in the header, with no count text', async () => {
    stubGateway(makeItems(2))
    render(<Bell counts={{ total: 2, unread: 2 }} />)
    open()
    const header = (await screen.findByRole('heading', { name: 'Notifications' })).closest(
      'header',
    )!
    expect(within(header).queryByText('2 unread')).not.toBeInTheDocument()
    for (const name of ['Mark all as read', 'Dismiss all'])
      expect(within(header).getByRole('button', { name })).toBeInTheDocument()
    expect(within(header).getAllByRole('button')).toHaveLength(2)
  })
})
