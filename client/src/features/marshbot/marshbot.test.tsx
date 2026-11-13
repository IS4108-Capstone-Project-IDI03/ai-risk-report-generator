// MarshBot on the Overview (AS-06, test seam 4): fixture threads (testThreads.ts), a fixture
// OpenUI program and its fallback, the row endings, the action slot and its calendar, the Earlier
// fold, the admin view, pushes and the per-assessment cache. The gateway is a stubbed fetch and
// the push stream a stand-in EventSource; no network, no AI.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../design-system'
import { MarshBotOverview } from './screens/MarshBotOverview'
import { Thread } from './components/thread/Thread'
import {
  REF,
  THREAD_URL,
  admin,
  bothDone,
  checklist,
  earlierFolded,
  generateOutline,
  surveyDay,
  thread,
  todo,
  turn,
  visitQuestion,
  visitReplies,
} from './testThreads'
import type { AssistantThread } from './types'
import { clearThreadCache } from './useThread'

// The stand-in gateway (set up by show()): GET answers the queue of threads in turn (the last one
// repeats); a reply answers `answer`.
let threads: AssistantThread[] = []
let answer: AssistantThread
// The status the reply route answers with; 500 makes it refuse. `replyCode` goes in its body.
let replyStatus = 200
let replyCode: string | undefined
let posts: { url: string; body: unknown }[] = []
let gets = 0
const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// The stand-in push stream: tests fire `brief` or `open` on the open one.
class FakeEventSource {
  static open: FakeEventSource[] = []
  static CLOSED = 2
  readyState = 1
  onerror: (() => void) | null = null
  listeners: Record<string, (() => void)[]> = {}
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.open.push(this)
  }
  addEventListener(type: string, fn: () => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  close() {
    FakeEventSource.open = FakeEventSource.open.filter((s) => s !== this)
  }
  emit(type: string) {
    this.listeners[type]?.forEach((fn) => fn())
  }
}

beforeEach(() => {
  posts = []
  gets = 0
  replyStatus = 200
  replyCode = undefined
  FakeEventSource.open = []
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Each test uses its own reference, so the module cache of an earlier test never answers it.
let refs = 0
function show(first: AssistantThread, openLink = vi.fn()) {
  refs += 1
  const reference = `${REF}-${refs}`
  const url = `/api/assessments/${reference}/assistant`
  const swap = (t: AssistantThread) => ({ ...t, reference })
  threads = [swap(first)]
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && u === url) {
      gets += 1
      return json(threads.length > 1 ? threads.shift() : threads[0])
    }
    posts.push({
      url: u.replace(reference, REF),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    if (u === `${url}/replies`)
      return replyStatus === 200
        ? json(answer)
        : json({ error: 'Down', code: replyCode }, replyStatus)
    return json(null, 204)
  })
  const view = render(
    <>
      <Toaster />
      <MarshBotOverview reference={reference} openLink={openLink} openDetails={vi.fn()} />
    </>,
  )
  return { ...view, reference, openLink }
}

describe('MarshBot Overview', () => {
  it('draws survey day: rail, greeting, the to-do card and its row endings', async () => {
    const { openLink } = show(surveyDay)
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
    // Bold names from **…**, the tail on the first bubble only.
    expect(screen.getByText('Pasir Gudang').tagName).toBe('B')
    const bubbles = document.querySelectorAll('.mbt-bubble')
    expect([...bubbles].map((b) => b.hasAttribute('data-tail'))).toEqual([true, false])
    // The rail: status pill, stages, at a glance, the client card.
    expect(screen.getByText('2 things to fix')).toBeTruthy()
    expect(screen.getByText('Survey')).toBeTruthy()
    expect(screen.getByText('25 of 42')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Harbourline Properties/ })).toBeTruthy()
    // The card: its note, both rows, and a link button that opens where the work is.
    expect(screen.getByRole('group', { name: 'To do' }).textContent).toContain('0 of 2 done')
    fireEvent.click(screen.getByRole('button', { name: 'Review Morning walk' }))
    expect(openLink).toHaveBeenCalledWith({ tab: 'observations', params: { walk: 'w1' } })
    // The action slot offers Skip for now, under the newest turn's card.
    const slot = screen.getByRole('group', { name: 'Your reply' })
    expect(within(slot).getByRole('button', { name: 'Skip for now' })).toBeTruthy()
    expect(slot.closest('.mbt-turn')?.contains(screen.getByRole('group', { name: 'To do' }))).toBe(
      true,
    )
  })

  it('opens a row with a link from anywhere on it', async () => {
    const { openLink } = show(surveyDay)
    fireEvent.click(await screen.findByText('9 proposed observations'))
    expect(openLink).toHaveBeenCalledTimes(1)
  })

  it('runs Try again in place and shows the row busy at once, with no toast', async () => {
    show(surveyDay)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again Loading Bay 2' }))
    expect(screen.getByText('Transcribing')).toBeTruthy()
    expect(screen.queryByText(/Trying .* again/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again Loading Bay 2' })).toBeNull()
    await waitFor(() =>
      expect(posts).toEqual([
        { url: '/api/observations/o1/recordings/r1/transcription/retry', body: null },
      ]),
    )
  })

  it('shows Done where the buttons were and a green acknowledgement, with no action slot', async () => {
    show(bothDone)
    expect(await screen.findByText(/Nice work, Alex!/)).toBeTruthy()
    expect(screen.getAllByText('Done')).toHaveLength(2)
    expect(document.querySelector('.mbt-bubble[data-tone="good"]')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Your reply' })).toBeNull()
    expect(screen.getByRole('img', { name: 'MarshBot, pleased' })).toBeTruthy()
  })

  it('draws the checklist card: the area to work on, See all, and the ticked ones', async () => {
    const { openLink } = show(checklist)
    expect(await screen.findByText('Sprinkler type and design')).toBeTruthy()
    expect(screen.getByText('+5 more')).toBeTruthy()
    expect(screen.getByText('Security')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'See all of Fire Protection' }))
    expect(openLink).toHaveBeenCalledWith({ tab: 'checklist', params: { area: 'Fire Protection' } })
  })

  it('sends a reply: the engineer’s bubble at once, the slot gone, then the answer', async () => {
    answer = thread({
      ...visitQuestion,
      stage: 'ready_for_generation',
      session: {
        ...visitQuestion.session,
        turns: [
          ...visitQuestion.session.turns,
          turn({ who: 'engineer', says: [{ text: 'That’s everything', tone: 'normal' }] }),
          turn({ says: [{ text: 'Great! I’ve moved it on.', tone: 'good' }] }),
        ],
      },
      replies: [],
      updatedAt: '2026-11-11T03:00:00.000Z',
    })
    show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'That’s everything' }))
    expect(screen.getByText('That’s everything', { selector: '.mbt-me' })).toBeTruthy()
    // The slot goes at once: no disabled buttons are left behind, and focus holds on MarshBot's turn.
    expect(screen.queryByRole('button', { name: 'I need another visit' })).toBeNull()
    expect(document.activeElement?.classList.contains('mbt-turn')).toBe(true)
    expect(await screen.findByText('Great! I’ve moved it on.')).toBeTruthy()
    // Focus moves to MarshBot's newest turn, never the page's top.
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain('Great! I’ve moved it on.'),
    )
    // The newest turn on screen goes with it, so a second press elsewhere is refused.
    const lastTurnId = visitQuestion.session.turns.at(-1)!.id
    expect(posts).toEqual([
      { url: `${THREAD_URL}/replies`, body: { replyId: 'ready-to-generate', lastTurnId } },
    ])
    expect(await screen.findByText('Moved to Ready for generation')).toBeTruthy()
    // The saved turn replaced the pending bubble: one, not two.
    expect(screen.getAllByText('That’s everything', { selector: '.mbt-me' })).toHaveLength(1)
    expect(screen.queryByRole('group', { name: 'Your reply' })).toBeNull()
  })

  it('moves focus to the newest turn when a pushed turn arrives and focus had fallen to the page', () => {
    const next = (turns: ReturnType<typeof turn>[]) => {
      const t = thread()
      return { ...t, session: { ...t.session, turns } }
    }
    const first = turn({ says: [{ text: 'First thing', tone: 'normal' }] })
    const { rerender } = render(
      <Thread thread={next([first])} pending={null} answered={0} actions={null} />,
    )
    // Opening the screen leaves focus alone, and so does a turn MarshBot adds by itself.
    expect(document.activeElement).toBe(document.body)
    const second = turn({ says: [{ text: 'Second thing', tone: 'normal' }] })
    rerender(<Thread thread={next([first, second])} pending={null} answered={0} actions={null} />)
    expect(document.activeElement).toBe(document.body)
    // Focus was in the thread and its element went away (the first turn is replaced).
    screen.getByText('First thing').closest<HTMLElement>('.mbt-turn')!.focus()
    const third = turn({ says: [{ text: 'Third thing', tone: 'normal' }] })
    rerender(<Thread thread={next([second, third])} pending={null} answered={0} actions={null} />)
    expect(document.activeElement).toBe(document.body)
    const fourth = turn({ says: [{ text: 'Fourth thing', tone: 'normal' }] })
    rerender(
      <Thread thread={next([second, third, fourth])} pending={null} answered={0} actions={null} />,
    )
    expect(document.activeElement?.textContent).toContain('Fourth thing')
    // Focus somewhere else on purpose stays there.
    const elsewhere = document.body.appendChild(document.createElement('button'))
    elsewhere.focus()
    const fifth = turn({ says: [{ text: 'Fifth thing', tone: 'normal' }] })
    rerender(
      <Thread
        thread={next([second, third, fourth, fifth])}
        pending={null}
        answered={0}
        actions={null}
      />,
    )
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('picks another visit: calendar, then confirm, then one reply with the day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
    answer = { ...visitQuestion, replies: [], surveyEnd: '2026-11-20' }
    show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'I need another visit' }))
    const calendar = screen.getByRole('dialog', { name: 'Day of Your Next Visit' })
    expect(within(calendar).getByRole('button', { name: '16 November 2026' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(within(calendar).getByRole('button', { name: '20 November 2026' }))
    // Nothing is sent until Confirm.
    const confirm = screen.getByRole('dialog', { name: 'Confirm the New Survey End' })
    expect(within(confirm).getByText('Fri 20 Nov 2026')).toBeTruthy()
    expect(confirm.textContent).toMatch(/Survey End\s*11 Nov\s*→\s*to\s*20 Nov/)
    expect(posts).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('I need another visit on Fri 20 Nov')).toBeTruthy()
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: `${THREAD_URL}/replies`,
          body: {
            replyId: 'another-visit',
            date: '2026-11-20',
            lastTurnId: visitQuestion.session.turns.at(-1)!.id,
          },
        },
      ]),
    )
    // A short, generic toast (round 7).
    expect(await screen.findByText('Survey end date updated')).toBeTruthy()
  })

  it('shows the bar and arrow while the slot is scrolled away, one set of buttons at a time', async () => {
    // A stand-in IntersectionObserver: the test reports for the slot's end mark itself.
    type Report = (entries: Partial<IntersectionObserverEntry>[]) => void
    const watches: { target: Element; report: Report }[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        report: Report
        constructor(report: Report) {
          this.report = report
        }
        observe = (target: Element) => void watches.push({ target, report: this.report })
        unobserve = () => undefined
        disconnect = () => undefined
        takeRecords = () => []
      },
    )
    show(visitQuestion)
    const slot = await screen.findByRole('group', { name: 'Your reply' })
    const end = watches.findLast((w) => w.target.classList.contains('mbt-slot-end'))!
    const away = document.querySelector<HTMLElement>('.mbt-away')!
    expect(screen.queryByRole('button', { name: 'Scroll to Latest Message' })).toBeNull()

    act(() => end.report([{ isIntersecting: false }]))
    expect(away.hasAttribute('data-away')).toBe(true)
    expect(screen.getByRole('button', { name: 'Scroll to Latest Message' })).toBeTruthy()
    const barButton = within(away).getByRole('button', { name: 'That’s everything' })
    // The slot stands down while the bar holds its buttons.
    expect(slot.hasAttribute('inert')).toBe(true)

    // Back in view: both go, and focus in the bar moves to the same button in the slot.
    barButton.focus()
    act(() => end.report([{ isIntersecting: true }]))
    expect(away.hasAttribute('data-away')).toBe(false)
    expect(slot.hasAttribute('inert')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Scroll to Latest Message' })).toBeNull()
    expect(document.activeElement).toBe(
      within(slot).getByRole('button', { name: 'That’s everything' }),
    )
  })

  it('opens a choice with a link without posting it, keeping the question', async () => {
    const { openLink } = show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'Add observations' }))
    expect(openLink).toHaveBeenCalledWith({ tab: 'observations' })
    expect(document.querySelector('.mbt-me')).toBeNull()
    expect(screen.getByRole('button', { name: 'That’s everything' })).toBeTruthy()
    await act(async () => {})
    expect(posts).toEqual([])
  })

  it('draws the action slot only under the newest bot turn, its card’s next step first', async () => {
    const outline = generateOutline.session.turns[0]
    show(
      thread({
        ...generateOutline,
        session: {
          ...generateOutline.session,
          turns: [outline, turn({ says: [{ text: 'One more thing.', tone: 'normal' }] })],
        },
      }),
    )
    expect(await screen.findByText('One more thing.')).toBeTruthy()
    // The older turn's card no longer draws its button, and the newest turn has none.
    expect(screen.queryByRole('button', { name: 'Open Generation' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Your reply' })).toBeNull()
    cleanup()
    show(thread({ ...generateOutline, replies: visitReplies }))
    const slot = await screen.findByRole('group', { name: 'Your reply' })
    expect(
      within(slot)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Open Generation', 'I need another visit', 'Add observations', 'That’s everything'])
    expect(screen.getByRole('group', { name: 'Sections' }).contains(slot)).toBe(false)
    // The next step is the solid navy one; a choice beside it is the soft pill, even a primary one.
    const navy = (name: string) =>
      within(slot).getByRole('button', { name }).style.background === 'var(--action-primary)'
    expect([navy('Open Generation'), navy('That’s everything')]).toEqual([true, false])
  })

  it('quietly reads the thread again when a reply was already answered elsewhere', async () => {
    replyStatus = 409
    replyCode = 'reply-not-asked'
    show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'That’s everything' }))
    await waitFor(() => expect(gets).toBe(2))
    expect(screen.queryByText('Down')).toBeNull()
    expect(await screen.findByRole('button', { name: 'That’s everything' })).toBeTruthy()
  })

  it('says why in a toast when a reply is refused for another reason, such as an archive', async () => {
    replyStatus = 409
    show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'That’s everything' }))
    expect(await screen.findByText('Down')).toBeTruthy()
    expect(gets).toBe(1)
  })

  it('draws the generate outline with no row singled out, rows that open, and one button', async () => {
    const { openLink } = show(generateOutline)
    expect(await screen.findByText('2 of 3 sections ready')).toBeTruthy()
    expect(document.querySelector('.mbt-ol[data-next]')).toBeNull()
    // The state is in the row's name too, not only in its icon; a note that repeats it is dropped.
    expect(screen.getByRole('button', { name: /Occupancy.*Questions for you/ })).toBeTruthy()
    expect(screen.queryByText('3 questions')).toBeNull()
    expect(screen.getByText('Questions for you')).toBeTruthy()
    // A row with a link opens its section; one without is plain text.
    fireEvent.click(screen.getByRole('button', { name: /Occupancy/ }))
    expect(openLink).toHaveBeenCalledWith({ tab: 'generate', params: { section: '8' } })
    expect(screen.queryByRole('button', { name: /Fire Protection/ })).toBeNull()
    // Its one button is in the action slot under the turn (round 7), not in the card.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Your reply' })).getByRole('button', {
        name: 'Open Generation',
      }),
    )
    expect(openLink).toHaveBeenLastCalledWith({ tab: 'generate' })
  })

  it('shows an admin the lanes and time in each stage, with nothing to answer', async () => {
    show(admin)
    expect(await screen.findByText('Alex Rowe’s assessment')).toBeTruthy()
    expect(screen.getByText('Decisions to make')).toBeTruthy()
    expect(screen.getByText('28 Nov')).toBeTruthy()
    expect(screen.getByText('Review, 6 days, now')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Your reply' })).toBeNull()
  })

  it('folds earlier sessions away, and shows them read-only when asked', async () => {
    show(earlierFolded)
    expect(await screen.findByText(/Since Wednesday, both are sorted/)).toBeTruthy()
    expect(screen.queryByText(/Wednesday’s greeting/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Earlier/ }))
    expect(screen.getByText(/Wednesday’s greeting/)).toBeTruthy()
    // Read-only: the earlier card's rows have no buttons.
    expect(screen.getByText('Morning walk')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review Morning walk' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Hide Earlier/ }))
    expect(screen.queryByText(/Wednesday’s greeting/)).toBeNull()
  })

  it('draws a fixture OpenUI program with the turn’s card', async () => {
    const program = [
      'root = Reply([s1, c1])',
      's1 = Say("Two things need you, starting with **Loading Bay 2**.")',
      'c1 = Card("todo")',
    ].join('\n')
    show(
      thread({
        session: {
          ...surveyDay.session,
          turns: [
            turn({ says: [{ text: 'Plain words.', tone: 'normal' }], cards: [todo], program }),
          ],
        },
      }),
    )
    expect(await screen.findByText(/Two things need you, starting with/)).toBeTruthy()
    expect(screen.getByText('Loading Bay 2', { selector: 'b' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review Morning walk' })).toBeTruthy()
    // The program replaced the plain words.
    expect(screen.queryByText('Plain words.')).toBeNull()
  })

  // The gateway's own program for a turn whose words sit between its cards (session.ts programOf).
  it('draws a server-written program with each bubble between its cards', async () => {
    const thin = { ...todo, id: 'thin', title: 'Thin' }
    const program = [
      'root = Reply([p0, p1, p2, p3, p4])',
      'p0 = Say("First lead.")',
      'p1 = Card("todo")',
      'p2 = Say("Second lead.")',
      'p3 = Card("thin")',
      'p4 = Say("Closing words.")',
    ].join('\n')
    show(
      thread({
        session: {
          ...surveyDay.session,
          turns: [turn({ says: [], cards: [todo, thin], program })],
        },
      }),
    )
    const order = [
      await screen.findByText('First lead.'),
      screen.getByRole('group', { name: 'To do' }),
      screen.getByText('Second lead.'),
      screen.getByRole('group', { name: 'Thin' }),
      screen.getByText('Closing words.'),
    ]
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('falls back to the says and cards for a broken program', async () => {
    for (const program of [
      'root = Reply([s1, c1])\ns1 = Say("Look at',
      'root = Reply([s1, c1, c2])\ns1 = Say("Twice.")\nc1 = Card("todo")\nc2 = Card("todo")',
    ]) {
      show(
        thread({
          session: {
            ...surveyDay.session,
            turns: [
              turn({ says: [{ text: 'Plain words.', tone: 'normal' }], cards: [todo], program }),
            ],
          },
        }),
      )
      expect(await screen.findByText('Plain words.')).toBeTruthy()
      expect(screen.getByText('Morning walk')).toBeTruthy()
      cleanup()
    }
  })

  // Rule 8: cards are rebuilt live, so a program keeps its words when its turn gains or loses one.
  it('keeps a program’s words when its cards change, drawing a new card after them', async () => {
    const program = 'root = Reply([s1])\ns1 = Say("Words from the AI.")'
    show(
      thread({
        session: {
          ...surveyDay.session,
          turns: [
            turn({ says: [{ text: 'Plain words.', tone: 'normal' }], cards: [todo], program }),
          ],
        },
      }),
    )
    expect(await screen.findByText('Words from the AI.')).toBeTruthy()
    expect(screen.queryByText('Plain words.')).toBeNull()
    expect(screen.getByText('Morning walk')).toBeTruthy()
  })

  it('takes the engineer’s bubble back and brings the slot back when a reply is refused', async () => {
    replyStatus = 500
    show(visitQuestion)
    fireEvent.click(await screen.findByRole('button', { name: 'That’s everything' }))
    expect(screen.getByText('That’s everything', { selector: '.mbt-me' })).toBeTruthy()
    await waitFor(() =>
      expect(screen.queryByText('That’s everything', { selector: '.mbt-me' })).toBeNull(),
    )
    expect(
      screen.getByRole('button', { name: 'That’s everything' }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('drops a read sent before a reply that answers after it', async () => {
    answer = thread({
      ...visitQuestion,
      session: {
        ...visitQuestion.session,
        turns: [
          ...visitQuestion.session.turns,
          turn({ says: [{ text: 'Answered.', tone: 'normal' }] }),
        ],
      },
      replies: [],
    })
    // A push's read that is still on its way when the reply is pressed.
    let release: (r: Response) => void = () => {}
    const { reference } = show(visitQuestion)
    expect(await screen.findByText(/everything from site/)).toBeTruthy()
    const url = `/api/assessments/${reference}/assistant`
    const stubbed = globalThis.fetch
    vi.stubGlobal('fetch', (u: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' && u === url
        ? new Promise<Response>((r) => (release = r))
        : stubbed(u, init),
    )
    await act(async () => FakeEventSource.open[0].emit('brief'))
    fireEvent.click(screen.getByRole('button', { name: 'That’s everything' }))
    expect(await screen.findByText('Answered.')).toBeTruthy()
    await act(async () => release(json({ ...visitQuestion, reference })))
    expect(screen.getByText('Answered.')).toBeTruthy()
  })

  it('replaces a cached thread with the failed state when the gateway refuses the re-read', async () => {
    const { reference, unmount } = show(surveyDay)
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
    unmount()
    vi.stubGlobal('fetch', async () => json({ error: 'Not yours' }, 403))
    render(<MarshBotOverview reference={reference} openLink={vi.fn()} openDetails={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t load/)
    expect(screen.queryByText(/is in the Capture stage/)).toBeNull()
  })

  it('forgets every cached thread on sign-out', async () => {
    const { reference, unmount } = show(surveyDay)
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
    unmount()
    clearThreadCache()
    render(<MarshBotOverview reference={reference} openLink={vi.fn()} openDetails={vi.fn()} />)
    expect(screen.queryByText(/is in the Capture stage/)).toBeNull()
  })

  it('reads again on a push, not on the first connect, and animates only the new turn', async () => {
    const pushed = thread({
      session: {
        ...surveyDay.session,
        turns: [
          ...surveyDay.session.turns,
          turn({ says: [{ text: 'A new finding came in.', tone: 'normal' }] }),
        ],
      },
      updatedAt: '2026-11-11T02:50:00.000Z',
    })
    show(surveyDay)
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
    threads = [{ ...pushed, reference: threads[0].reference }]
    await act(async () => FakeEventSource.open[0].emit('open'))
    expect(gets).toBe(1)
    await act(async () => FakeEventSource.open[0].emit('brief'))
    const added = await screen.findByText('A new finding came in.')
    expect(added.closest('.mbt-turn')?.hasAttribute('data-fresh')).toBe(true)
    expect(
      screen
        .getByText(/is in the Capture stage/)
        .closest('.mbt-turn')
        ?.hasAttribute('data-fresh'),
    ).toBe(false)
  })

  it('shows the cached thread at once when the Overview opens again', async () => {
    const { reference, unmount } = show(surveyDay)
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
    unmount()
    render(<MarshBotOverview reference={reference} openLink={vi.fn()} openDetails={vi.fn()} />)
    // No loading state: the thread is there before the background read answers.
    expect(screen.getByText(/is in the Capture stage/)).toBeTruthy()
    await waitFor(() => expect(gets).toBe(2))
  })

  it('offers Try again when the thread cannot load', async () => {
    let fail = true
    vi.stubGlobal('fetch', async () => (fail ? json({ error: 'down' }, 500) : json(surveyDay)))
    render(<MarshBotOverview reference="RPT-FAIL" openLink={vi.fn()} openDetails={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t load/)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText(/is in the Capture stage/)).toBeTruthy()
  })
})
