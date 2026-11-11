// MarshBot on the Overview (AS-06, test seam 4): a fixture brief, a fixture OpenUI program, the
// plain fallback, quick replies, the admin view, pacing and a pushed tick-off. The gateway is a
// stubbed fetch and the push stream a stand-in EventSource; no network, no AI.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarshBotOverview } from './screens/MarshBotOverview'
import type { AssistantBrief, BriefItem, BriefMessage } from './types'

// Short waits so pacing runs in real time here; the pause stays long enough to see.
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  TYPING_MS: 5,
  WORD_MS: 1,
  WIDGET_MS: 1,
  MESSAGE_PAUSE_MS: 2000,
}))

const REF = 'RPT-2026-0003'
const BRIEF_URL = `/api/assessments/${REF}/assistant`

const walk: BriefItem = {
  id: 'capture.walk-ready:w1',
  kind: 'walk-ready',
  stage: 'capture',
  weight: 'fix_now',
  title: 'Morning walk',
  detail: '10:42 · 9 proposed',
  fact: 'Your morning walk is ready to review.',
  icon: 'footprints',
  link: { tab: 'observations', params: { walk: 'w1' } },
  action: null,
  actionTarget: null,
  facts: {},
  fingerprint: 'a',
  dismissible: false,
  firstSeenAt: '2026-11-14T02:00:00.000Z',
  resolvedAt: null,
}
const recording: BriefItem = {
  ...walk,
  id: 'capture.failed-transcription:o1:r1',
  kind: 'failed-transcription',
  title: 'Loading Bay 2',
  detail: "1:48 · Couldn't transcribe",
  icon: 'mic',
  link: null,
  action: 'retry-transcription',
  actionTarget: 'o1:r1',
}
const reminder: BriefItem = {
  ...walk,
  id: 'review.comments:7',
  kind: 'new-comments',
  weight: 'reminder',
  title: '2 new comments from Sana',
  detail: 'Both on Construction, yesterday afternoon.',
  icon: 'message-square',
  link: { tab: 'review' },
  dismissible: true,
}

const greeting: BriefMessage = {
  id: 'm1',
  text: 'Morning, Alex. Pasir Gudang is coming along nicely.',
  program: null,
  parts: [],
  tone: 'normal',
}
const rows: BriefMessage = {
  id: 'm2',
  text: 'Your morning walk is ready, and one recording didn’t come through.',
  program: null,
  parts: [{ type: 'actions', itemIds: [walk.id, recording.id] }],
  tone: 'normal',
}
const health: BriefMessage = {
  id: 'm3',
  text: 'Here’s the checklist by area.',
  program: null,
  parts: [
    { type: 'health', areas: [] },
    { type: 'link', label: 'Add observation', link: { tab: 'observations' }, icon: 'plus' },
  ],
  tone: 'normal',
}

/** Returns a brief; by default opened before with nothing new since, so nothing is paced. */
function brief(over: Partial<AssistantBrief> = {}): AssistantBrief {
  return {
    reference: REF,
    viewer: 'engineer',
    engineerName: 'Alex Rowe',
    stage: 'capture',
    stageDates: {
      setup: '2026-11-03',
      prepare: '2026-11-11',
      capture: '2026-11-13',
      ready_for_generation: null,
      generate: null,
      review: null,
      ready_to_export: null,
      exported: null,
    },
    surveyStart: '2026-11-14',
    surveyEnd: '2026-11-14',
    reportDue: '2026-12-18',
    client: { id: 'c1', name: 'Harbourline Properties', reference: REF },
    mood: 'concerned',
    items: [walk, recording],
    areas: [
      { area: 'External Exposures', total: 5, covered: 0, thin: true },
      { area: 'Security', total: 4, covered: 3, thin: false },
    ],
    sections: [],
    export: null,
    coverage: { status: 'idle', checkedAt: null },
    thread: [],
    messages: [greeting, rows, health],
    lastOpenedAt: '2026-11-14T03:00:00.000Z',
    updatedAt: '2026-11-14T02:30:00.000Z',
    ...over,
  }
}

// The stand-in gateway: GET answers the queue of briefs in turn (the last one repeats).
let briefs: AssistantBrief[] = []
let posts: { url: string; body: unknown }[] = []
const reply = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// The stand-in push stream: tests fire `brief` on the open one.
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
  FakeEventSource.open = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === BRIEF_URL)
      return reply(briefs.length > 1 ? briefs.shift() : briefs[0])
    posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === `${BRIEF_URL}/replies`) return reply(briefs[0])
    return reply(null, 204)
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// MarshBot's words come one span per word, so match the whole paragraph's text.
const said = (words: RegExp) => (_: string, el: Element | null) =>
  !!el?.classList.contains('mb-say') && words.test(el.textContent ?? '')

const show = (openLink = vi.fn()) =>
  render(<MarshBotOverview reference={REF} openLink={openLink} openDetails={vi.fn()} />)

describe('MarshBot Overview', () => {
  it('greets, lists the action rows and shows the health bars of a fixture brief', async () => {
    briefs = [brief()]
    const openLink = vi.fn()
    show(openLink)
    expect(await screen.findByText(said(/Pasir Gudang is coming along nicely/))).toBeTruthy()
    expect(screen.getByText('Morning walk')).toBeTruthy()
    expect(screen.getByText('Loading Bay 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry Loading Bay 2' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /External Exposures: 0 of 5/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'MarshBot, concerned' })).toBeTruthy()
    // The rail: stages in order, the survey day beside Capture.
    expect(screen.getByText('Survey')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review Morning walk' }))
    expect(openLink).toHaveBeenCalledWith(walk.link)
  })

  it('draws a fixture OpenUI program with the same parts', async () => {
    const program = [
      'root = Reply([s1, a1, l1])',
      's1 = Say("Two things need you, starting with **Loading Bay 2**.")',
      `a1 = ActionRow("${recording.id}")`,
      'l1 = LinkButton("Add one now", "link-1")',
    ].join('\n')
    briefs = [brief({ messages: [{ ...health, id: 'p1', program }] })]
    show()
    expect(
      await screen.findByText(said(/Two things need you, starting with Loading Bay 2/)),
    ).toBeTruthy()
    expect(screen.getByText('Loading Bay 2', { selector: '.mb-row-title' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add one now/ })).toBeTruthy()
    // The program replaced the plain words.
    expect(screen.queryByText(said(/checklist by area/))).toBeNull()
  })

  it('falls back to the plain words and the same rows for a broken program', async () => {
    const program = 'root = Reply([s1, a1])\ns1 = Say("Look at'
    briefs = [brief({ messages: [{ ...rows, program }] })]
    show()
    expect(await screen.findByText(said(/Your morning walk is ready/))).toBeTruthy()
    expect(screen.getByText('Morning walk')).toBeTruthy()
    expect(screen.getByText('Loading Bay 2')).toBeTruthy()
    expect(screen.queryByText(said(/Look at/))).toBeNull()
  })

  // The gateway refuses programs naming unknown ids (wording.service.ts); one that slips through
  // still draws, and the unknown part draws nothing.
  it('draws a program that names an unknown id without that part', async () => {
    const program = `root = Reply([s1, a1])\ns1 = Say("Look at this.")\na1 = ActionRow("nope")`
    briefs = [brief({ messages: [{ ...rows, program }] })]
    show()
    expect(await screen.findByText(said(/^Look at this\.$/))).toBeTruthy()
    expect(screen.queryByText('Morning walk')).toBeNull()
  })

  it('sends a quick reply as its pre-filled words', async () => {
    const question: BriefMessage = {
      id: 'q1',
      text: 'Anything more to come from the client?',
      program: null,
      tone: 'question',
      parts: [
        {
          type: 'replies',
          replies: [{ id: 'nothing-more', label: 'Nothing more', primary: true, picksDate: false }],
        },
      ],
    }
    briefs = [brief({ messages: [question] })]
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Nothing more' }))
    // The button becomes the engineer's own bubble while it is sent, and can't be sent twice.
    expect(screen.getByText('Nothing more', { selector: '.mb-me' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nothing more' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Nothing more' }))
    await waitFor(() =>
      expect(posts).toEqual([{ url: `${BRIEF_URL}/replies`, body: { replyId: 'nothing-more' } }]),
    )
  })

  it('sends another visit with the picked day, as one reply', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
    const question: BriefMessage = {
      id: 'q2',
      text: 'Is that everything from site, or do you need another visit?',
      program: null,
      tone: 'normal',
      parts: [
        {
          type: 'replies',
          replies: [
            {
              id: 'ready-to-generate',
              label: 'That’s everything',
              primary: true,
              picksDate: false,
            },
            { id: 'another-visit', label: 'I need another visit', primary: false, picksDate: true },
          ],
        },
      ],
    }
    briefs = [brief({ messages: [question] })]
    show()
    fireEvent.click(await screen.findByRole('button', { name: /I need another visit/ }))
    const calendar = screen.getByRole('dialog', { name: 'Day of your next visit' })
    expect(within(calendar).getByRole('button', { name: '16 November 2026' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(within(calendar).getByRole('button', { name: '20 November 2026' }))
    expect(screen.getByText('I need another visit on Fri 20 Nov 2026')).toBeTruthy()
    await waitFor(() =>
      expect(posts).toEqual([
        { url: `${BRIEF_URL}/replies`, body: { replyId: 'another-visit', date: '2026-11-20' } },
      ]),
    )
  })

  it('shows an admin stage and progress only: no dismiss and no replies', async () => {
    const question: BriefMessage = {
      id: 'q3',
      text: 'Hi Sana. This one is Alex Rowe’s.',
      program: null,
      tone: 'normal',
      parts: [
        { type: 'actions', itemIds: [reminder.id] },
        {
          type: 'replies',
          replies: [{ id: 'not-now', label: 'Not now', primary: false, picksDate: false }],
        },
      ],
    }
    briefs = [brief({ viewer: 'admin', items: [reminder], messages: [question] })]
    show()
    expect(await screen.findByText('Alex Rowe’s assessment')).toBeTruthy()
    expect(screen.getByText('2 new comments from Sana')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })

  it('dismisses a reminder', async () => {
    briefs = [
      brief({
        items: [reminder],
        messages: [{ ...rows, parts: [{ type: 'actions', itemIds: [reminder.id] }] }],
      }),
    ]
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss 2 new comments from Sana' }))
    await waitFor(() =>
      expect(posts).toEqual([{ url: `${BRIEF_URL}/dismissals`, body: { itemId: reminder.id } }]),
    )
  })

  it('paces new messages one at a time, and Show all skips the wait', async () => {
    briefs = [brief({ lastOpenedAt: '2026-11-14T01:00:00.000Z' })]
    show()
    // The first message types out; the second waits out the pause (2 s here, 8 s for real).
    expect(await screen.findByText(said(/coming along nicely\.\s*$/))).toBeTruthy()
    expect(screen.queryByText('Morning walk')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByText('Morning walk')).toBeTruthy()
    expect(screen.getByText(said(/checklist by area/))).toBeTruthy()
  })

  it('ticks off a row when a push says it was resolved', async () => {
    briefs = [brief(), brief({ items: [walk], mood: 'idle' })]
    show()
    expect(await screen.findByText('Loading Bay 2')).toBeTruthy()
    expect(FakeEventSource.open[0].url).toBe(`${BRIEF_URL}/events`)
    await act(async () => FakeEventSource.open[0].emit('brief'))
    expect((await screen.findByText('Done')).getAttribute('role')).toBe('status')
    expect(screen.getByRole('img', { name: 'MarshBot' })).toBeTruthy()
  })

  it('reads the brief again when the stream reconnects, keeping the newer brief', async () => {
    const newer = brief({ items: [walk], mood: 'idle', updatedAt: '2026-11-14T02:40:00.000Z' })
    const older = brief({ updatedAt: '2026-11-14T02:20:00.000Z' })
    briefs = [brief(), newer, older]
    show()
    expect(await screen.findByText('Loading Bay 2')).toBeTruthy()
    // A reconnect may have missed a push: it reads again and the resolved row ticks off.
    await act(async () => FakeEventSource.open[0].emit('open'))
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy())
    // A late answer older than what is shown changes nothing.
    await act(async () => FakeEventSource.open[0].emit('brief'))
    await act(async () => new Promise((r) => setTimeout(r, 20)))
    expect(screen.getByRole('img', { name: 'MarshBot' })).toBeTruthy()
  })

  it('draws an area with many items as one filled bar, not slivers', async () => {
    briefs = [
      brief({
        messages: [health],
        areas: [
          { area: 'Fire Protection', total: 40, covered: 10, thin: true },
          { area: 'Security', total: 4, covered: 3, thin: false },
        ],
      }),
    ]
    show()
    const big = await screen.findByRole('img', { name: /Fire Protection: 10 of 40/ })
    expect(big.querySelectorAll('i')).toHaveLength(1)
    expect(big.querySelector('i')?.getAttribute('style')).toContain('width: 25%')
    expect(
      screen.getByRole('img', { name: /Security: 3 of 4/ }).querySelectorAll('i'),
    ).toHaveLength(4)
  })

  it('offers Try again when the brief cannot load', async () => {
    let fail = true
    briefs = [brief()]
    vi.stubGlobal('fetch', async () => (fail ? reply({ error: 'down' }, 500) : reply(briefs[0])))
    show()
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t load/)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Loading Bay 2')).toBeTruthy()
  })
})
