// Tests for the shared counts (F-10 sound rules, trap: the bell is mounted on every screen):
// one poller above the screens, a baseline that survives a screen change, and own actions
// that never chime. chimeOnce is replaced, since the audio can't be heard here.
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCountsProvider } from './NotificationCountsContext'
import { useNotificationCounts } from './useNotificationCounts'
import { useNotifications } from './useNotifications'

const played = vi.hoisted(() => vi.fn())
vi.mock('./chime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chime')>()),
  chimeOnce: played,
}))

let served = { total: 0, unread: 0, inboxTodo: 0 }
const fetchMock = vi.fn(() => Promise.resolve(Response.json(served)))

// Stands in for a screen: shows the counts and lets a test act as the person.
function Screen({ name }: { name: string }) {
  const { counts, change } = useNotificationCounts()
  return (
    <div>
      <span data-testid={name}>{`${counts.unread}/${counts.inboxTodo}`}</span>
      <button onClick={() => change((c) => ({ ...c, inboxTodo: c.inboxTodo + 1 }))}>
        own action
      </button>
    </div>
  )
}

const poll = () => act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  served = { total: 0, unread: 0, inboxTodo: 0 }
  played.mockClear()
  fetchMock.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Acts as the person in the bell, against a gateway whose writes all fail.
function BellActions() {
  const n = useNotifications(5)
  return (
    <div>
      <button onClick={n.load}>load</button>
      <button onClick={() => n.markRead('n1')}>mark read</button>
      <button onClick={n.markAllRead}>mark all</button>
      <button onClick={() => n.dismiss('n1')}>dismiss</button>
      <button onClick={n.dismissAll}>dismiss all</button>
      <span>{n.items.length} rows</span>
    </div>
  )
}

describe('NotificationCountsProvider', () => {
  it('sets the baseline on the first poll, then plays for a rise', async () => {
    render(
      <NotificationCountsProvider initial={{ total: 0, unread: 0, inboxTodo: 0 }}>
        <Screen name="a" />
      </NotificationCountsProvider>,
    )
    served = { total: 2, unread: 2, inboxTodo: 0 }
    await poll()
    expect(screen.getByTestId('a')).toHaveTextContent('2/0')
    expect(played).not.toHaveBeenCalled()

    served = { total: 3, unread: 3, inboxTodo: 1 }
    await poll()
    expect(played).toHaveBeenCalledTimes(1)
    expect(played.mock.calls[0][0]).toBe('inbox')
  })

  it('keeps one poller and its baseline when the screen changes', async () => {
    const tree = (name: string) => (
      <NotificationCountsProvider initial={{ total: 0, unread: 1, inboxTodo: 2 }}>
        <Screen name={name} />
      </NotificationCountsProvider>
    )
    const { rerender } = render(tree('first'))
    served = { total: 1, unread: 1, inboxTodo: 2 }
    await poll()
    // A different screen mounts under the same provider: counts carry over, nothing replays.
    rerender(tree('second'))
    expect(screen.getByTestId('second')).toHaveTextContent('1/2')
    fetchMock.mockClear()
    await poll()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(played).not.toHaveBeenCalled()
  })

  it('does not chime for your own action, even when a poll then agrees with it', async () => {
    render(
      <NotificationCountsProvider initial={{ total: 0, unread: 0, inboxTodo: 0 }}>
        <Screen name="a" />
      </NotificationCountsProvider>,
    )
    await poll()
    act(() => screen.getByRole('button', { name: 'own action' }).click())
    expect(screen.getByTestId('a')).toHaveTextContent('0/1')
    served = { total: 0, unread: 0, inboxTodo: 1 }
    await poll()
    expect(played).not.toHaveBeenCalled()
  })

  it.each(['mark read', 'mark all', 'dismiss', 'dismiss all'])(
    'does not chime on the next poll when "%s" fails',
    async (action) => {
      served = { total: 2, unread: 2, inboxTodo: 0 }
      const row = { id: 'n1', read: false, message: 'm', createdAt: '2026-11-05T03:42:00.000Z' }
      fetchMock.mockImplementation(((url: string, init?: RequestInit) => {
        if (init?.method) return Promise.reject(new TypeError('Failed to fetch'))
        if (url.includes('/count')) return Promise.resolve(Response.json(served))
        return Promise.resolve(Response.json({ ...served, items: [row] }))
      }) as never)
      render(
        <NotificationCountsProvider initial={served}>
          <Screen name="a" />
          <BellActions />
        </NotificationCountsProvider>,
      )
      await poll()
      await act(async () => screen.getByRole('button', { name: 'load' }).click())
      expect(screen.getByText('1 rows')).toBeInTheDocument()
      await act(async () => screen.getByRole('button', { name: action }).click())
      expect(screen.getByTestId('a')).toHaveTextContent('2/0')
      await poll()
      expect(played).not.toHaveBeenCalled()
      fetchMock.mockImplementation(() => Promise.resolve(Response.json(served)))
    },
  )

  it('draws nothing new when a poll brings the same figures', async () => {
    const drew = vi.fn()
    const Counted = () => {
      useNotificationCounts()
      drew()
      return null
    }
    served = { total: 1, unread: 1, inboxTodo: 1 }
    render(
      <NotificationCountsProvider initial={served}>
        <Counted />
      </NotificationCountsProvider>,
    )
    await poll()
    const before = drew.mock.calls.length
    await poll()
    await poll()
    expect(drew).toHaveBeenCalledTimes(before)
  })

  it('counts a change only when a poll, not the person, moved the To do figure', async () => {
    const seen: number[] = []
    const Changes = () => {
      seen.push(useNotificationCounts().outsideChanges)
      return null
    }
    render(
      <NotificationCountsProvider initial={{ total: 0, unread: 0, inboxTodo: 1 }}>
        <Changes />
        <Screen name="a" />
      </NotificationCountsProvider>,
    )
    served = { total: 0, unread: 0, inboxTodo: 1 }
    await poll()
    expect(seen.at(-1)).toBe(0)
    act(() => screen.getByRole('button', { name: 'own action' }).click())
    expect(seen.at(-1)).toBe(0)
    served = { total: 0, unread: 0, inboxTodo: 2 }
    await poll()
    expect(seen.at(-1)).toBe(0)
    served = { total: 0, unread: 0, inboxTodo: 0 }
    await poll()
    expect(seen.at(-1)).toBe(1)
  })

  it('keeps polling while the tab is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      render(
        <NotificationCountsProvider initial={{ total: 0, unread: 0, inboxTodo: 0 }}>
          <Screen name="a" />
        </NotificationCountsProvider>,
      )
      await poll()
      served = { total: 1, unread: 1, inboxTodo: 0 }
      await poll()
      expect(played).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    }
  })
})
