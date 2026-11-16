// The thread's pacing and numbered steps (AS-06 round 9, items A and F): a pushed turn arrives one
// message at a time on fake timers, and a run of steps is one numbered list. Draws Thread
// straight, no gateway and no network.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadHarness as Thread } from './testHarness'
import { MarshBotOverview } from './screens/MarshBotOverview'
import { MarshBotContext } from './context'
import { ACTIONS_MS, FIRST_MESSAGE_MS, MESSAGE_GAP_MS } from './settings'
import { REF, thread, todo, turn } from './testThreads'
import type { AssistantThread, Turn } from './types'

// matchMedia as a browser has it; `reduce` turns reduced motion on.
function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMotion(false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const withTurns = (turns: Turn[], over: Partial<AssistantThread> = {}) => {
  const t = thread()
  return { ...t, session: { ...t.session, turns }, ...over }
}
const choice = <button type="button">Pick me</button>
const draw = (t: AssistantThread, actions: ReactNode = choice) => (
  <Thread thread={t} pending={null} answered={0} actions={actions} />
)
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const said = (text: string) => screen.queryByText(text)
// The typing dots: not a live region (the thread's log would announce them between messages).
const dots = () => document.querySelector('.mb-typing')

// One pushed turn of two messages: a speech bubble, then an alert in its own bubble.
const pushed = () =>
  turn({
    says: [
      { text: 'First message', tone: 'normal' },
      { text: 'Second message', tone: 'alert' },
    ],
  })

describe('the reveal queue', () => {
  it('draws the typing dots hidden from assistive tech, not as a second live region', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, pushed()])))
    expect(dots()?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows only the typing dots at 0 ms, then one message at a time, the choices last', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    expect(said('Opening')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()

    rerender(draw(withTurns([opening, pushed()])))
    expect(dots()).toBeTruthy()
    expect(said('First message')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pick me' })).toBeNull()

    tick(FIRST_MESSAGE_MS - 1)
    expect(said('First message')).toBeNull()
    tick(1)
    expect(said('First message')).toBeTruthy()
    // The dots stay under the first message and the second waits for the gap.
    expect(dots()).toBeTruthy()
    expect(screen.queryByText(/Second message/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pick me' })).toBeNull()

    tick(MESSAGE_GAP_MS - 1)
    expect(screen.queryByText(/Second message/)).toBeNull()
    tick(1)
    expect(screen.getByText(/Second message/)).toBeTruthy()
    // The last message is out: the dots go, but the choices are their own beat after it.
    expect(dots()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pick me' })).toBeNull()
    tick(ACTIONS_MS - 1)
    expect(screen.queryByRole('button', { name: 'Pick me' })).toBeNull()
    tick(1)
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()
  })

  it('never hides a message that is already shown when a turn lands before it', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const a = turn({ says: [{ text: 'Turn A', tone: 'normal' }] })
    const b = turn({ says: [{ text: 'Turn B', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, a, b])))
    tick(FIRST_MESSAGE_MS)
    tick(MESSAGE_GAP_MS)
    expect(said('Turn A') && said('Turn B')).toBeTruthy()
    // A turn is slotted in between them: both stay on screen, the new one waits its beat.
    const c = turn({ says: [{ text: 'Turn C', tone: 'normal' }] })
    rerender(draw(withTurns([opening, a, c, b])))
    expect(said('Turn A')).toBeTruthy()
    expect(said('Turn B')).toBeTruthy()
    expect(said('Turn C')).toBeNull()
    tick(MESSAGE_GAP_MS)
    expect(said('Turn C')).toBeTruthy()
    expect(said('Turn A') && said('Turn B')).toBeTruthy()
  })

  it('shows the turns there when the thread opens at once, never replayed', () => {
    render(draw(withTurns([turn({ says: [{ text: 'Already there', tone: 'normal' }] })])))
    expect(said('Already there')).toBeTruthy()
    expect(dots()).toBeNull()
    tick(5000)
    expect(said('Already there')).toBeTruthy()
  })

  it('does not queue turns again when the same thread is read again in the background', () => {
    const opening = turn({ says: [{ text: 'Cached greeting', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([{ ...opening }], { updatedAt: '2026-11-11T03:00:00.000Z' })))
    expect(said('Cached greeting')).toBeTruthy()
    expect(dots()).toBeNull()
  })

  it('shows everything at once under reduced motion', () => {
    stubMotion(true)
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, pushed()])))
    expect(said('First message')).toBeTruthy()
    expect(screen.getByText(/Second message/)).toBeTruthy()
    expect(dots()).toBeNull()
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()
  })

  it('queues a turn that arrives late after the ones before it', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const first = pushed()
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, first])))
    tick(FIRST_MESSAGE_MS)
    tick(MESSAGE_GAP_MS)
    expect(screen.getByText(/Second message/)).toBeTruthy()
    // Much later, another turn is pushed: dots first, its message FIRST_MESSAGE_MS after.
    tick(10_000)
    const late = turn({ says: [{ text: 'Late news', tone: 'normal' }] })
    rerender(draw(withTurns([opening, first, late])))
    expect(said('Late news')).toBeNull()
    expect(dots()).toBeTruthy()
    tick(FIRST_MESSAGE_MS)
    expect(said('Late news')).toBeTruthy()
    expect(dots()).toBeNull()
  })

  it('keeps the dots while MarshBot is still writing, after every message is out', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, pushed()], { thinking: true })))
    tick(FIRST_MESSAGE_MS)
    tick(MESSAGE_GAP_MS)
    expect(dots()).toBeTruthy()
  })
})

// Hides or shows the tab the way a browser does, and tells the page.
const tabHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}
describe('a hidden tab', () => {
  afterEach(() => tabHidden(false))

  it('shows a turn pushed while the tab is hidden at once, and keeps it when the tab returns', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender } = render(draw(withTurns([opening])))
    tabHidden(true)
    rerender(draw(withTurns([opening, pushed()])))
    expect(said('First message')).toBeTruthy()
    expect(screen.getByText(/Second message/)).toBeTruthy()
    expect(dots()).toBeNull()
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()
    // Back on the tab: nothing is replayed or hidden again.
    tabHidden(false)
    expect(said('First message')).toBeTruthy()
    expect(screen.getByText(/Second message/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()
  })

  it('shows everything still waiting when the tab becomes hidden mid-queue, and stops listening on unmount', () => {
    const opening = turn({ says: [{ text: 'Opening', tone: 'normal' }] })
    const { rerender, unmount } = render(draw(withTurns([opening])))
    rerender(draw(withTurns([opening, pushed()])))
    tick(FIRST_MESSAGE_MS)
    expect(screen.queryByText(/Second message/)).toBeNull()
    tabHidden(true)
    expect(screen.getByText(/Second message/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeTruthy()
    const off = vi.spyOn(document, 'removeEventListener')
    unmount()
    expect(off).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})

// A thread with a to-do card, so a bold name can link to its row.
const inBot = (t: AssistantThread, openLink = vi.fn()) =>
  render(
    <MarshBotContext.Provider value={{ thread: t, openLink, retry: vi.fn(), busy: new Set() }}>
      {draw(t, null)}
    </MarshBotContext.Provider>,
  )

describe('numbered steps', () => {
  it('draws a Steps piece as one numbered list with the place name bold and linked', () => {
    const program = [
      'root = Reply([s1, p1, c1])',
      's1 = Say("Four places still need a look.")',
      'p1 = Steps(["**Morning walk** needs its review.", "**Loading Bay 2** needs another try."])',
      'c1 = Card("todo")',
    ].join('\n')
    const t = withTurns([turn({ topic: 'todo', cards: [todo], program })])
    const openLink = vi.fn()
    inBot(t, openLink)
    const list = document.querySelector('ol.mbt-steps')!
    expect(list.children).toHaveLength(2)
    // The lead words and the list share one bubble.
    expect(list.closest('.mbt-bubble')?.textContent).toContain('Four places')
    expect(named(list, 'Morning walk').tagName).toBe('SPAN')
    // A name the card lists opens its row; one it doesn't list stays bold.
    fireEvent.click(screen.getByRole('button', { name: 'Morning walk' }))
    expect(openLink).toHaveBeenCalledWith({ tab: 'observations', params: { walk: 'w1' } })
    expect(named(list, 'Loading Bay 2').tagName).toBe('B')
  })

  it('draws a run of step says without a program as ONE numbered list', () => {
    const t = withTurns([
      turn({
        topic: 'todo',
        says: [
          { text: 'Four places still need a look.', tone: 'normal' },
          { text: '**Morning walk** needs its review.', tone: 'step' },
          { text: '**Loading Bay 2** needs another try.', tone: 'step' },
          { text: '**Roof** needs a photo.', tone: 'step' },
        ],
        cards: [todo],
      }),
    ])
    inBot(t)
    const lists = document.querySelectorAll('ol.mbt-steps')
    expect(lists).toHaveLength(1)
    expect(
      [...lists[0].children].map((li) => li.querySelector('b, [role=button]')?.textContent),
    ).toEqual(['Morning walk', 'Loading Bay 2', 'Roof'])
    expect(lists[0].closest('.mbt-bubble')?.textContent).toContain('Four places')
    // The name the card lists is still a link.
    expect(screen.getByRole('button', { name: 'Morning walk' })).toBeTruthy()
  })
})

// The element holding `name` inside `root`.
const named = (root: Element, name: string) =>
  [...root.querySelectorAll('b, [role=button]')].find((e) => e.textContent === name)!

// The Overview's own width decides rail or stage bar (item 2): a stand-in ResizeObserver tells it.
describe('the rail gives way to the stage bar when the Overview is narrow', () => {
  const watchers: { el: Element; fn: (e: unknown[]) => void }[] = []
  let width = 900
  beforeEach(() => {
    vi.useRealTimers()
    watchers.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        fn: (e: unknown[]) => void
        constructor(fn: (e: unknown[]) => void) {
          this.fn = fn
        }
        observe(el: Element) {
          watchers.push({ el, fn: this.fn })
        }
        disconnect() {}
      },
    )
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return { width: this.classList.contains('mb') ? width : 0 } as DOMRect
    })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(thread()), { status: 200 }))
  })
  afterEach(() => vi.restoreAllMocks())

  const open = async () => {
    render(
      <MarshBotOverview reference={`${REF}-narrow`} openLink={vi.fn()} openDetails={vi.fn()} />,
    )
    await screen.findByText(/is in the Capture stage/)
  }
  const resize = (w: number) =>
    act(() => {
      width = w
      for (const { el, fn } of watchers) if (el.classList.contains('mb')) fn([])
    })

  it('keeps the rail from 808 px (rail 248 + conversation 560) and folds it below', async () => {
    width = 808
    await open()
    expect(document.querySelector('.mb-rail')).toBeTruthy()
    expect(document.querySelector('.mb')?.hasAttribute('data-stacked')).toBe(false)
    resize(807)
    expect(document.querySelector('.mb-rail')).toBeNull()
    expect(document.querySelector('.mb-phonebar')).toBeTruthy()
    expect(document.querySelector('.mb')?.hasAttribute('data-stacked')).toBe(true)
    resize(1100)
    expect(document.querySelector('.mb-rail')).toBeTruthy()
  })

  it('opens already folded when the Overview starts narrow (no flash of the rail)', async () => {
    width = 600
    await open()
    expect(document.querySelector('.mb-rail')).toBeNull()
    expect(document.querySelector('.mb-phonebar')).toBeTruthy()
  })
})

// The status pill and MarshBot's face wait for the newest message (item 1): the pill under
// MarshBot's name shows what was last shown until the queue has shown the pushed message.
describe('the status pill follows the conversation', () => {
  class Source {
    static open: Source[] = []
    listeners: Record<string, (() => void)[]> = {}
    constructor() {
      Source.open.push(this)
    }
    addEventListener(type: string, fn: () => void) {
      ;(this.listeners[type] ??= []).push(fn)
    }
    close() {}
    emit(type: string) {
      this.listeners[type]?.forEach((fn) => fn())
    }
  }
  const first = turn({ says: [{ text: 'Hello again', tone: 'normal' }] })
  const second = turn({ says: [{ text: 'Brand new news', tone: 'normal' }] })
  const before = thread({
    reference: `${REF}-pill`,
    status: { text: 'Old status', tone: 'blue', icon: 'clock' },
    mood: 'idle',
    session: { ...thread().session, turns: [first] },
  })
  const after = (over: Partial<AssistantThread> = {}) =>
    ({
      ...before,
      status: { text: 'New status', tone: 'green', icon: 'circle-check' },
      mood: 'pleased',
      session: { ...before.session, turns: [first, second] },
      updatedAt: '2026-11-11T05:00:00.000Z',
      ...over,
    }) as AssistantThread
  const pill = () => document.querySelector('.mb-status')?.textContent
  let next: AssistantThread

  // Opens the Overview on `before`, then pushes `pushed` the way the gateway does.
  async function pushAfterOpening(pushed: AssistantThread) {
    next = before
    Source.open = []
    vi.stubGlobal('EventSource', Source)
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(next), { status: 200 }))
    render(
      <MarshBotOverview reference={before.reference} openLink={vi.fn()} openDetails={vi.fn()} />,
    )
    await act(async () => {})
    expect(pill()).toBe('Old status')
    next = pushed
    await act(async () => Source.open[0].emit('brief'))
  }

  it('says MarshBot is typing on a first open, until its messages are out', async () => {
    const opening = { ...before, reference: `${REF}-first`, thinking: true } as AssistantThread
    next = opening
    Source.open = []
    vi.stubGlobal('EventSource', Source)
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(next), { status: 200 }))
    render(
      <MarshBotOverview reference={opening.reference} openLink={vi.fn()} openDetails={vi.fn()} />,
    )
    await act(async () => {})
    // Nothing was shown before, so nothing is held: never the status of a message still to come.
    expect(pill()).toBe('Typing…')
    next = after({ reference: opening.reference })
    await act(async () => Source.open[0].emit('brief'))
    expect(pill()).toBe('Typing…')
    tick(FIRST_MESSAGE_MS)
    expect(said('Brand new news')).toBeTruthy()
    expect(pill()).toBe('New status')
  })

  it('keeps the old pill and face while the dots show, and changes them with the last message', async () => {
    await pushAfterOpening(after())
    expect(dots()).toBeTruthy()
    expect(said('Brand new news')).toBeNull()
    expect(pill()).toBe('Old status')
    expect(screen.getByRole('img', { name: 'MarshBot' })).toBeTruthy()
    tick(FIRST_MESSAGE_MS)
    expect(said('Brand new news')).toBeTruthy()
    expect(pill()).toBe('New status')
    expect(screen.getByRole('img', { name: 'MarshBot, pleased' })).toBeTruthy()
  })

  it('keeps the old pill while MarshBot is still writing, and does not hold the facts', async () => {
    await pushAfterOpening(
      after({
        thinking: true,
        glance: [{ icon: 'camera', label: 'Observations', value: '99', tone: 'normal' }],
      }),
    )
    expect(pill()).toBe('Old status')
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('shows the new pill at once under reduced motion', async () => {
    stubMotion(true)
    await pushAfterOpening(after())
    expect(pill()).toBe('New status')
  })
})
