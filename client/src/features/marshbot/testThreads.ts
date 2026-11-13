// Fixture conversation threads for MarshBot's tests (AS-06): survey day, both done, the
// checklist, the visit question, the generate outline, an admin, and an earlier session folded
// away. Shaped like the gateway's GET /assistant (types.ts). Used by marshbot.test.tsx.
import type { AssistantThread, Card, CardRow, Reply, Session, Turn } from './types'

export const REF = 'RPT-2026-0072'
export const THREAD_URL = `/api/assessments/${REF}/assistant`

let n = 0
/** Returns a bot turn (or an engineer one with `who`), said a minute after the last. */
export function turn(over: Partial<Turn> = {}): Turn {
  n += 1
  return {
    id: `t${n}`,
    who: 'bot',
    at: new Date(Date.UTC(2026, 10, 11, 2, 23, n)).toISOString(),
    topic: 'greeting',
    mood: 'idle',
    says: [],
    cards: [],
    program: null,
    ...over,
  }
}

export const walkRow: CardRow = {
  id: 'capture.walk-ready:w1',
  icon: 'footprints',
  tone: 'violet',
  title: 'Morning walk',
  detail: '9 proposed observations',
  bad: false,
  quote: null,
  end: {
    type: 'button',
    label: 'Review',
    icon: null,
    link: { tab: 'observations', params: { walk: 'w1' } },
    action: null,
    actionTarget: null,
  },
}
export const recordingRow: CardRow = {
  id: 'capture.failed-transcription:o1:r1',
  icon: 'mic',
  tone: 'red',
  title: 'Loading Bay 2',
  detail: 'Couldn’t transcribe',
  bad: true,
  quote: null,
  end: {
    type: 'button',
    label: 'Try again',
    icon: 'rotate-ccw',
    link: null,
    action: 'retry-transcription',
    actionTarget: 'o1:r1',
  },
}
export const todo: Card = {
  type: 'tasks',
  id: 'todo',
  title: 'To do',
  done: 0,
  total: 2,
  rows: [walkRow, recordingRow],
}

const skip: Reply = {
  id: 'skip',
  label: 'Skip for now',
  primary: true,
  picksDate: false,
  link: null,
}
export const visitReplies: Reply[] = [
  {
    id: 'another-visit',
    label: 'I need another visit',
    primary: false,
    picksDate: true,
    link: null,
  },
  // Only opens the Observations tab: nothing is posted (round 7).
  {
    id: 'add-observations',
    label: 'Add observations',
    primary: false,
    picksDate: false,
    link: { tab: 'observations' },
  },
  {
    id: 'ready-to-generate',
    label: 'That’s everything',
    primary: true,
    picksDate: false,
    link: null,
  },
]

const session = (turns: Turn[], over: Partial<Session> = {}): Session => ({
  id: 's-today',
  startedAt: turns[0]?.at ?? '2026-11-11T02:23:00.000Z',
  stage: 'capture',
  turns,
  ...over,
})

/** Returns a thread on survey day; `over` replaces any field. */
export function thread(over: Partial<AssistantThread> = {}): AssistantThread {
  return {
    reference: REF,
    viewer: 'engineer',
    engineerName: 'Alex Rowe',
    stage: 'capture',
    stageDates: {
      setup: '2026-11-03',
      prepare: '2026-11-05',
      capture: '2026-11-10',
      ready_for_generation: null,
      generate: null,
      review: null,
      ready_to_export: null,
      exported: null,
    },
    surveyStart: '2026-11-11',
    surveyEnd: '2026-11-11',
    reportDue: '2026-12-16',
    client: { id: 'c1', name: 'Harbourline Properties', reference: REF },
    mood: 'concerned',
    status: { text: '2 things to fix', tone: 'red', icon: 'circle-alert' },
    glance: [
      { icon: 'camera', label: 'Observations', value: '18', tone: 'normal' },
      { icon: 'list-checks', label: 'Checklist', value: '25 of 42', tone: 'normal' },
      { icon: 'calendar', label: 'Report due', value: '16 Dec', tone: 'normal' },
    ],
    earlier: [],
    session: session([
      turn({
        says: [
          { text: 'Good morning, Alex! **Pasir Gudang** is in the Capture stage.', tone: 'normal' },
          { text: 'There are 2 things I need you to sort out first.', tone: 'normal' },
        ],
      }),
      turn({ topic: 'todo', cards: [todo] }),
    ]),
    replies: [skip],
    thinking: false,
    updatedAt: '2026-11-11T02:23:30.000Z',
    ...over,
  }
}

/** Survey day: the greeting and the to-do card, with Skip for now. */
export const surveyDay = thread()

/** Both done: the rows ticked in place and MarshBot's green acknowledgement. */
export const bothDone = thread({
  mood: 'pleased',
  status: { text: 'Both done', tone: 'green', icon: 'circle-check' },
  session: session([
    turn({
      topic: 'todo',
      cards: [
        {
          ...todo,
          done: 2,
          rows: [
            { ...walkRow, tone: 'green', end: { type: 'status', status: 'done', label: 'Done' } },
            {
              ...recordingRow,
              tone: 'green',
              bad: false,
              detail: 'Recording transcribed',
              end: { type: 'status', status: 'done', label: 'Done' },
            },
          ],
        },
      ],
    }),
    turn({
      topic: 'ack',
      mood: 'pleased',
      says: [{ text: 'Nice work, Alex! Both came through.', tone: 'good' }],
    }),
  ]),
  replies: [],
  updatedAt: '2026-11-11T02:41:00.000Z',
})

const checklistCard: Card = {
  type: 'checklist',
  id: 'checklist',
  answered: 25,
  total: 42,
  gaps: [
    {
      area: 'Fire Protection',
      icon: 'flame',
      tone: 'amber',
      covered: 4,
      total: 12,
      items: ['Sprinkler type and design', 'Water supply and flow test'],
      more: 5,
      link: { tab: 'checklist', params: { area: 'Fire Protection' } },
    },
  ],
  fine: [{ title: 'Security', detail: '3 of 4', bar: { covered: 3, total: 4 } }],
}
/** The checklist: one area to work on, one ticked, What else? in the action slot. */
export const checklist = thread({
  session: session([
    turn({
      topic: 'checklist',
      says: [{ text: 'Now let’s look at what the report still needs.', tone: 'normal' }],
      cards: [checklistCard],
    }),
  ]),
  replies: [{ id: 'what-else', label: 'What else?', primary: true, picksDate: false, link: null }],
})

/** The visit question after the survey day passed. */
export const visitQuestion = thread({
  status: { text: '1 question for you', tone: 'blue', icon: 'message-circle-question' },
  session: session([
    turn({
      topic: 'visit-question',
      says: [
        { text: 'Is that everything from site, or do you need another visit?', tone: 'normal' },
      ],
    }),
  ]),
  replies: visitReplies,
})

/** Generate: the outline, with its Open Generation drawn in the action slot. */
export const generateOutline = thread({
  stage: 'generate',
  session: session([
    turn({
      topic: 'sections',
      says: [{ text: 'Good afternoon, Alex! 9 of 11 sections are drafted.', tone: 'normal' }],
      cards: [
        {
          type: 'outline',
          id: 'sections',
          title: 'Sections',
          lead: '2 of 3 sections ready',
          items: [
            { no: '2', title: 'Executive Summary', state: 'ok', note: null, link: null },
            {
              no: '8',
              title: 'Occupancy',
              state: 'question',
              note: '3 questions',
              link: { tab: 'generate', params: { section: '8' } },
            },
            { no: '9', title: 'Fire Protection', state: 'ok', note: null, link: null },
          ],
          next: null,
          key: [
            { state: 'ok', label: 'Drafted' },
            { state: 'question', label: 'Questions for you' },
          ],
          cta: { label: 'Open Generation', link: { tab: 'generate' } },
        },
      ],
    }),
  ]),
  replies: [],
})

/** An admin: lanes and time in each stage, nothing to answer. */
export const admin = thread({
  viewer: 'admin',
  stage: 'review',
  status: { text: 'Alex Rowe’s assessment', tone: 'blue', icon: 'user-round' },
  session: session([
    turn({
      topic: 'greeting',
      says: [{ text: 'Hi Sana! This one is Alex Rowe’s.', tone: 'normal' }],
      cards: [
        {
          type: 'lanes',
          id: 'lanes',
          title: 'Sections',
          note: '1 of 2 reviewed',
          lanes: [
            {
              state: 'wait',
              label: 'Decisions to make',
              items: [{ no: '7', title: 'Construction', date: null, comments: 2 }],
            },
            { state: 'new', label: 'Not started', items: [] },
            {
              state: 'ok',
              label: 'Reviewed',
              items: [{ no: '3', title: 'Opportunities', date: '2026-11-28', comments: 0 }],
            },
          ],
        },
        {
          type: 'stage-time',
          id: 'stage-time',
          title: 'Time in each stage',
          note: '30 days so far',
          spans: [
            { label: 'Setup', days: 8, now: false },
            { label: 'Review', days: 6, now: true },
          ],
        },
      ],
    }),
  ]),
  replies: [],
})

/** Another day: Wednesday's session folded behind Earlier, a catch-up today. */
export const earlierFolded = thread({
  earlier: [
    session(
      [
        turn({
          at: '2026-11-11T02:23:00.000Z',
          says: [{ text: 'Wednesday’s greeting about survey day.', tone: 'normal' }],
          cards: [todo],
        }),
      ],
      { id: 's-wed', startedAt: '2026-11-11T02:23:00.000Z' },
    ),
  ],
  session: session(
    [
      turn({
        at: '2026-11-12T01:05:00.000Z',
        says: [{ text: 'Good morning, Alex! Since Wednesday, both are sorted.', tone: 'normal' }],
      }),
    ],
    { id: 's-thu', startedAt: '2026-11-12T01:05:00.000Z' },
  ),
  replies: [],
})
