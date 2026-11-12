// MarshBot's conversation engine without a database (AS-06 round 5): one topic
// at a time, rows that change in place, replies, sessions, the admin view.
// Each test builds the brief by hand and runs thread/advance.ts and view.ts.
import { describe, expect, it } from 'vitest'
import type { CoverageState } from '../models/assistant-brief.model'
import { raise } from '../services/assistant/item'
import type { BriefFacts } from '../services/assistant/phrases'
import { advance } from '../services/assistant/thread/advance'
import type { Event, ThreadBrief, ThreadState } from '../services/assistant/thread/types'
import { adminThread, viewThread } from '../services/assistant/thread/view'
import type { AreaHealth, BriefItem, Card, SectionState, Stage } from '../services/assistant/types'

// 10:00 in Singapore on the survey day (Saturday 14 Nov 2026).
const SURVEY_DAY = new Date('2026-11-14T02:00:00Z')
const LATER = new Date('2026-11-14T02:20:00Z')
const viewer = { name: 'Alex Rowe', dismissed: [], exportAgain: null }
const EMPTY: ThreadState = { earlier: [], session: null }

const facts = (extra: Partial<BriefFacts> = {}): BriefFacts => ({
  site: 'Pasir Gudang Cold Store',
  client: { id: null, name: 'Harbourline Properties', reference: 'RPT-2026-0072' },
  engineerName: 'Alex Rowe',
  observations: 18,
  surveyStart: '2026-11-14',
  surveyEnd: '2026-11-14',
  reportDue: '2026-12-16',
  anotherVisit: false,
  allDrafted: false,
  draftedParts: 0,
  stageDates: {
    setup: '2026-11-01T01:00:00.000Z',
    prepare: '2026-11-09T01:00:00.000Z',
    capture: '2026-11-12T01:00:00.000Z',
    ready_for_generation: null,
    generate: null,
    review: null,
    ready_to_export: null,
    exported: null,
  },
  exportedAt: null,
  exportDay: null,
  exportFile: null,
  hasChecklist: true,
  evidenceFingerprint: 'e',
  captureStarted: true,
  categorisedObservations: 18,
  documents: 3,
  walksReviewed: 0,
  recordingsTranscribed: 11,
  walkObservations: {},
  ...extra,
})

const item = (
  id: string,
  kind: string,
  weight: BriefItem['weight'],
  extra: Partial<BriefItem> = {},
): BriefItem => ({
  ...raise({
    id,
    kind,
    stage: 'capture',
    weight,
    title: extra.title ?? id,
    fact: extra.fact ?? id,
    icon: extra.icon ?? 'x',
    facts: extra.facts ?? {},
    link: extra.link ?? { tab: 'observations' },
    action: extra.action ?? null,
    actionTarget: extra.actionTarget ?? null,
    detail: extra.detail ?? null,
  }),
  firstSeenAt: SURVEY_DAY.toISOString(),
  resolvedAt: extra.resolvedAt ?? null,
})
const walk = (resolvedAt: string | null = null) =>
  item('walk.ready:w1', 'site-walks', 'fix_now', {
    title: 'Morning walk',
    icon: 'footprints',
    link: { tab: 'observations', params: { walk: 'w1' } },
    facts: { status: 'ready', proposed: 9 },
    resolvedAt,
  })
const recording = (status: 'failed' | 'busy', attempts = 1, resolvedAt: string | null = null) =>
  item('capture.failed-recording:o1:r1', 'failed-recording', 'fix_now', {
    title: 'Loading Bay 2',
    icon: 'mic',
    action: status === 'busy' ? null : 'retry-transcription',
    actionTarget: 'o1:r1',
    facts: { recording: 'Recording 1', attempts, status },
    resolvedAt,
  })

const area = (name: string, covered: number, total: number): AreaHealth => ({
  area: name,
  covered,
  total,
  thin: covered / total < 0.5,
  open: Array.from({ length: total - covered }, (_, n) => ({
    id: `${name}.${n}`,
    text: `${name} item ${n + 1}`,
  })),
})
const AREAS = [
  area('External Exposures', 0, 5),
  area('Fire Protection', 4, 12),
  area('Security', 3, 4),
  area('Management Programs', 5, 6),
  area('Occupancy and Hazards', 6, 7),
  area('Construction', 7, 8),
]
const NO_COVERAGE: CoverageState = {
  status: 'idle',
  startedAt: null,
  checkedAt: null,
  fingerprint: null,
  uncovered: [],
  thin: [],
}

const brief = (part: Partial<ThreadBrief> & { stage?: Stage } = {}): ThreadBrief => ({
  reference: 'RPT-2026-0072',
  stage: 'capture',
  items: [],
  areas: AREAS,
  sections: [],
  coverage: NO_COVERAGE,
  facts: facts(),
  updatedAt: SURVEY_DAY,
  ...part,
})

const run = (state: ThreadState, b: ThreadBrief, event: Event, now = SURVEY_DAY) =>
  advance(state, { brief: b, viewer, now }, event)
const view = (state: ThreadState, b: ThreadBrief, now = SURVEY_DAY) =>
  viewThread(state, { brief: b, viewer, now })
const topics = (turns: { topic: string }[]) => turns.map((t) => t.topic)
const rowsOf = (card: Card) => (card.type === 'tasks' || card.type === 'rows' ? card.rows : [])

// Survey day: a walk to review and a recording that failed.
const SURVEY = brief({ items: [walk(), recording('failed')] })

describe('opening the Overview', () => {
  it('greets, then raises only the to-dos on survey day (C1)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    expect(topics(first.added)).toEqual(['greeting', 'todo'])
    expect(first.added[0].says[0].text).toBe(
      'Good morning, Alex! Pasir Gudang Cold Store is in the Capture stage, and you already have 18 observations in, which is a great start for survey day.',
    )
    expect(first.added[1].says[0].text).toBe(
      'Before we look at what the report still needs, there are 2 things I need you to sort out first.',
    )
    const shown = view(first, SURVEY)
    expect(shown.session.turns[1].cards[0]).toMatchObject({
      type: 'tasks',
      title: 'To Do',
      done: 0,
      total: 2,
    })
    expect(rowsOf(shown.session.turns[1].cards[0]).map((r) => r.end)).toEqual([
      {
        type: 'button',
        label: 'Review',
        icon: null,
        link: { tab: 'observations', params: { walk: 'w1' } },
        action: null,
        actionTarget: null,
      },
      {
        type: 'button',
        label: 'Try Again',
        icon: 'rotate-ccw',
        link: null,
        action: 'retry-transcription',
        actionTarget: 'o1:r1',
      },
    ])
    expect(shown.replies.map((r) => r.id)).toEqual(['skip'])
    expect(shown.status).toEqual({ text: '2 things to fix', tone: 'red', icon: 'circle-alert' })
    expect(shown.mood).toBe('concerned')
    expect(shown.glance.map((g) => g.value)).toEqual(['18', '25 of 42', '16 Dec'])
  })

  it('adds nothing when opened twice (idempotent)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const again = run(first, SURVEY, { type: 'open' }, LATER)
    expect(again.added).toEqual([])
    expect(run(again, SURVEY, { type: 'changed' }, LATER).added).toEqual([])
    expect(again.session).toEqual(first.session)
  })
})

describe('tasks', () => {
  it('ticks the rows in place, then says "Nice work" and moves on to the checklist (C3, C4)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const done = brief({
      items: [walk(LATER.toISOString()), recording('failed', 2, LATER.toISOString())],
      facts: facts({ observations: 25, walkObservations: { w1: 7 } }),
    })
    const after = run(first, done, { type: 'changed' }, LATER)
    expect(topics(after.added)).toEqual(['ack', 'checklist'])
    expect(after.added[0].says).toEqual([
      {
        text: 'Nice work, Alex! The morning walk is in with 7 new observations, and Loading Bay 2 came through.',
        tone: 'good',
      },
    ])
    const shown = view(after, done, LATER)
    const todo = shown.session.turns[1].cards[0]
    expect(todo).toMatchObject({ done: 2, total: 2 })
    expect(rowsOf(todo).map((r) => [r.detail, r.end])).toEqual([
      ['7 observations created', { type: 'status', status: 'done', label: 'Done' }],
      ['Recording transcribed', { type: 'status', status: 'done', label: 'Done' }],
    ])
    const checklist = shown.session.turns[3].cards[0]
    expect(checklist).toMatchObject({ type: 'checklist', answered: 25, total: 42 })
    expect(
      checklist.type === 'checklist' && checklist.gaps.map((g) => [g.area, g.items.length, g.more]),
    ).toEqual([
      ['External Exposures', 3, 2],
      ['Fire Protection', 3, 5],
    ])
    expect(shown.session.turns[3].says[0].text).toMatch(
      /^Now let's look at what the report still needs\. I've lined your 25 observations up against this site's checklist\. 4 areas are in good shape, but 2 need more before you leave: External Exposures has nothing yet and Fire Protection is only at 4 of 12\./,
    )
    expect(shown.status.text).toBe('2 areas need more')
    // While the checklist turn is still being worded, the rail says both are done and the dots show.
    const writing = new Set([after.added[1].id])
    const meanwhile = viewThread(after, { brief: done, viewer, now: LATER, writing })
    expect([meanwhile.status.text, meanwhile.mood, meanwhile.thinking, meanwhile.replies]).toEqual([
      'Both done',
      'pleased',
      true,
      [],
    ])
  })

  it('keeps a retried recording on its row: Transcribing, then Done, or Open after a second failure (C2, C2b)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const row = (b: ThreadBrief) => rowsOf(view(first, b, LATER).session.turns[1].cards[0])[1]

    expect(row(brief({ items: [walk(), recording('busy', 2)] }))).toMatchObject({
      detail: 'Recording 1',
      end: { type: 'status', status: 'busy', label: 'Transcribing' },
    })
    expect(
      row(brief({ items: [walk(), recording('busy', 2, LATER.toISOString())] })),
    ).toMatchObject({
      tone: 'green',
      detail: 'Recording transcribed',
      end: { type: 'status', status: 'done', label: 'Done' },
    })
    const failedAgain = brief({ items: [walk(), recording('failed', 2)] })
    expect(row(failedAgain)).toMatchObject({
      detail: "Still couldn't transcribe",
      bad: true,
      end: {
        type: 'button',
        label: 'Open',
        link: { tab: 'observations', params: { obs: 'o1', media: 'r1' } },
      },
    })
    // MarshBot says sorry once, not on every change.
    const sorry = run(first, failedAgain, { type: 'changed' }, LATER)
    expect(topics(sorry.added)).toEqual(['sorry'])
    expect(sorry.added[0].says[0].text).toMatch(
      /^Sorry, Alex\. Loading Bay 2 still wouldn't transcribe\./,
    )
    expect(run(sorry, failedAgain, { type: 'changed' }, LATER).added).toEqual([])
  })

  it('"Skip for now" moves on while the tasks stay live (C11)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const skipped = run(first, SURVEY, { type: 'reply', reply: 'skip' }, LATER)
    expect(topics(skipped.added)).toEqual(['reply', 'answer', 'checklist'])
    expect(skipped.added[0].says[0].text).toBe('Skip for now')
    expect(skipped.added[1].says[0].text).toBe(
      "No problem. Those 2 will stay here until they're done.",
    )
    const shown = view(skipped, SURVEY, LATER)
    expect(rowsOf(shown.session.turns[1].cards[0])[0].end).toMatchObject({ label: 'Review' })
    expect(shown.status.text).toBe('2 things to fix')
  })

  it('raises a new Fix now item at once mid-session', () => {
    const first = run(EMPTY, brief(), { type: 'open' })
    const later = run(first, brief({ items: [recording('failed')] }), { type: 'changed' }, LATER)
    expect(topics(later.added)).toEqual(['todo'])
    expect(later.added[0].says[0].text).toBe(
      'Something new came up that I need you to sort out first.',
    )
  })
})

describe('what else and the coverage check', () => {
  // After the to-dos: the checklist waits, with coverage in whatever state is given.
  const atChecklist = (coverage: Partial<CoverageState>, items: BriefItem[] = []) => {
    const b = brief({ items, coverage: { ...NO_COVERAGE, ...coverage } })
    const first = run(EMPTY, b, { type: 'open' })
    expect(topics(first.added)).toEqual(['greeting', 'checklist'])
    return { b, first }
  }

  it('"What else?" brings the gaps: not covered and thin (C5)', () => {
    const thin = item('coverage.thin:o1:8', 'coverage-thin', 'gap', {
      title: 'Loading Bay 2',
      link: { tab: 'observations', params: { obs: 'o1' } },
      facts: {
        section: 'Occupancy',
        reason: 'Add contents, stacking and hazards',
        note: 'Walked Loading Bay 2.',
      },
    })
    const uncovered = item('coverage.uncovered:11', 'coverage-uncovered', 'gap', {
      title: 'Security',
    })
    const { b, first } = atChecklist(
      { status: 'done', checkedAt: LATER, uncovered: ['Security.0'] },
      [thin, uncovered],
    )
    expect(view(first, b).replies.map((r) => r.id)).toEqual(['what-else'])

    const next = run(first, b, { type: 'reply', reply: 'what-else' }, LATER)
    expect(topics(next.added)).toEqual(['reply', 'gaps'])
    expect(next.added[1].says[0].text).toBe(
      "Sure! I also read your observations against the checklist itself. 1 checklist item isn't mentioned anywhere yet, and 1 note is too thin to support its section. None of this blocks you today, but it's quicker to sort out while you're still on site.",
    )
    const [notCovered, thinCard] = next.added[1].cards
    expect(notCovered).toMatchObject({
      id: `${next.added[1].id}-not-covered`,
      title: 'Not Covered',
      note: '1 checklist item',
    })
    expect(rowsOf(notCovered)[0]).toMatchObject({
      title: 'Security item 1',
      detail: 'Security',
      end: { type: 'open', link: { tab: 'checklist', params: { item: 'Security.0' } } },
    })
    expect(rowsOf(thinCard)[0]).toMatchObject({
      quote: 'Walked Loading Bay 2.',
      detail: 'Add contents, stacking and hazards',
    })
    expect(view(next, b, LATER).status).toEqual({
      text: '2 gaps to close',
      tone: 'amber',
      icon: 'search',
    })
  })

  it('waits with the typing dots while the check runs, and says once when it failed (C12)', () => {
    const { b, first } = atChecklist({ status: 'running' })
    const waiting = run(first, b, { type: 'reply', reply: 'what-else' }, LATER)
    expect(topics(waiting.added)).toEqual(['reply'])
    expect(view(waiting, b, LATER).thinking).toBe(true)

    const failed = brief({ coverage: { ...NO_COVERAGE, status: 'failed', checkedAt: LATER } })
    const said = run(waiting, failed, { type: 'changed' }, LATER)
    expect(topics(said.added)).toEqual(['gaps-failed'])
    expect(said.added[0].says[0].text).toMatch(
      /^I tried to read your observations against the checklist/,
    )
    const shown = view(said, failed, LATER)
    expect([shown.thinking, shown.mood, shown.status.text, shown.replies]).toEqual([
      false,
      'concerned',
      'Checking again',
      [],
    ])
    expect(run(said, failed, { type: 'changed' }, LATER).added).toEqual([])

    // When the check works later, its gaps arrive as a new turn.
    const uncovered = item('coverage.uncovered:11', 'coverage-uncovered', 'gap', {
      title: 'Security',
    })
    const done = brief({
      items: [uncovered],
      coverage: { ...NO_COVERAGE, status: 'done', checkedAt: LATER, uncovered: ['Security.0'] },
    })
    expect(topics(run(said, done, { type: 'changed' }, LATER).added)).toEqual(['gaps'])

    // Or, with nothing to raise, MarshBot says so and the conversation moves on (ledger #1).
    const areaGap = item('capture.area:Fire Protection', 'area-gaps', 'gap')
    const nothing = brief({
      items: [areaGap],
      coverage: { ...NO_COVERAGE, status: 'done', checkedAt: LATER },
    })
    const movedOn = run(said, nothing, { type: 'changed' }, LATER)
    expect(topics(movedOn.added)).toEqual(['gaps'])
    expect(movedOn.added[0].says[0].text).toMatch(/Every checklist item is mentioned somewhere/)
    const after = view(movedOn, nothing, LATER)
    expect([after.status.text, after.mood]).toEqual(['No gaps found', 'pleased'])
    // While another visit holds the gaps there is nothing to say: the next topic comes instead.
    const held = brief({
      coverage: { ...NO_COVERAGE, status: 'done', checkedAt: LATER },
      facts: facts({ anotherVisit: true, surveyEnd: '2026-11-20' }),
    })
    expect(topics(run(said, held, { type: 'changed' }, LATER).added)).toEqual(['visit-set'])
  })
})

describe('the survey-day question (C6, C9, C10)', () => {
  const MONDAY = new Date('2026-11-16T01:05:00Z')
  const fine = AREAS.map((a) => ({ ...a, covered: a.total, thin: false, open: [] }))
  const past = brief({ areas: fine, facts: facts({ observations: 31 }) })

  it('asks, with two different replies', () => {
    const opened = run(EMPTY, past, { type: 'open' }, MONDAY)
    expect(topics(opened.added)).toEqual(['greeting', 'visit-question'])
    expect(opened.added[1].says.map((s) => s.text)).toEqual([
      "Your survey day has passed and you're at 31 observations now.",
      'Just 1 question before I move this on to generation: is that everything from site, or do you need another visit?',
    ])
    const shown = view(opened, past, MONDAY)
    expect(shown.replies).toEqual([
      { id: 'another-visit', label: 'I need another visit', primary: false, picksDate: true },
      { id: 'ready-to-generate', label: "That's everything", primary: true, picksDate: false },
    ])
    expect(shown.status).toEqual({
      text: '1 question for you',
      tone: 'blue',
      icon: 'message-square',
    })
  })

  it('"I need another visit" moves the survey end and holds the gaps', () => {
    const opened = run(EMPTY, past, { type: 'open' }, MONDAY)
    const booked = brief({
      areas: fine,
      facts: facts({ observations: 31, anotherVisit: true, surveyEnd: '2026-11-20' }),
    })
    const after = run(
      opened,
      booked,
      { type: 'reply', reply: 'another-visit', date: '2026-11-20' },
      MONDAY,
    )
    expect(after.added.map((t) => t.says[0].text)).toEqual([
      'I need another visit on Fri 20 Nov',
      "Done! The survey now ends on 20 Nov, and Pasir Gudang Cold Store stays in the Capture stage until then. I'll hold the gaps until you're back from site. Add whatever you gather on the day.",
    ])
    const shown = view(after, booked, MONDAY)
    expect([shown.replies, shown.status.text, shown.mood]).toEqual([
      [],
      'Next visit booked',
      'pleased',
    ])
  })

  it('"That\'s everything" moves on to Ready for generation in the same session', () => {
    const opened = run(EMPTY, past, { type: 'open' }, MONDAY)
    const ready = brief({
      stage: 'ready_for_generation',
      areas: fine,
      facts: facts({ observations: 31, categorisedObservations: 31 }),
    })
    const after = run(opened, ready, { type: 'reply', reply: 'ready-to-generate' }, MONDAY)
    expect(topics(after.added)).toEqual(['reply', 'answer', 'ready'])
    expect(after.added[1].says[0]).toEqual({
      text: "Great! I've moved Pasir Gudang Cold Store on to Ready for generation.",
      tone: 'good',
    })
    expect(after.added[2].cards[0]).toMatchObject({
      title: 'Ready to Generate',
      rows: [],
      ticks: [
        { title: 'Observations', detail: '31, all categorised', bar: null },
        { title: 'Checklist', detail: '42 of 42 answered', bar: null },
        { title: 'Sections', detail: 'All 11 have enough to draft', bar: null },
      ],
      cta: { label: 'Open Generation', link: { tab: 'generate' } },
    })
    expect(after.session!.id).toBe(opened.session!.id)
    expect(view(after, ready, MONDAY).status).toEqual({
      text: 'Ready to generate',
      tone: 'green',
      icon: 'sparkles',
    })
  })
})

describe('sessions', () => {
  it('starts a new session the next day: a catch-up, and the earlier cards frozen (H1, H2)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const MONDAY = new Date('2026-11-16T01:05:00Z')
    const sorted = '2026-11-15T03:00:00.000Z'
    const later = brief({
      items: [walk(sorted), recording('failed', 2, sorted)],
      facts: facts({ observations: 31, walkObservations: { w1: 7 } }),
    })
    const next = run(first, later, { type: 'open' }, MONDAY)
    expect(next.earlier).toHaveLength(1)
    expect(next.added[0].says[0].text).toBe(
      'Good morning, Alex! Since Saturday, the morning walk and the Loading Bay 2 recording are both sorted, and you added 13 more observations. That brings you to 31.',
    )
    // The catch-up's checklist is every area as a bar.
    expect(next.added[1].cards[0]).toMatchObject({ type: 'bars', answered: 25, total: 42 })
    const shown = view(next, later, MONDAY)
    // Saturday's card stays as it was then; today's rows are live.
    expect(rowsOf(shown.earlier[0].turns[1].cards[0])[0].end).toMatchObject({
      type: 'button',
      label: 'Review',
    })
    expect(shown.session.turns.map((t) => t.topic)).toEqual(['greeting', 'checklist'])
  })
})

describe('other stages', () => {
  it('outlines the sections while generating, nothing singled out (S4, round 6)', () => {
    const gen = brief({
      stage: 'generate',
      facts: facts({ draftedParts: 9, observations: 31 }),
      items: [
        item('generate.questions:8', 'draft-questions', 'gap', { facts: { questions: 3 } }),
        item('generate.figures:4', 'figures-missing', 'gap'),
        item('generate.out-of-date:7', 'out-of-date', 'gap'),
        item('generate.not-drafted', 'not-drafted', 'gap', { facts: { left: '2,3' } }),
      ],
    })
    const opened = run(EMPTY, gen, { type: 'open' })
    expect(topics(opened.added)).toEqual(['greeting', 'sections'])
    const card = opened.added[1].cards[0]
    expect(card.type === 'outline' && card.items.map((i) => [i.no, i.state, i.note])).toEqual([
      ['2', 'new', null],
      ['3', 'new', null],
      ['4', 'figures', 'Scores'],
      ['5', 'ok', null],
      ['6', 'ok', null],
      ['7', 'wait', 'Out of date'],
      ['8', 'question', '3 questions'],
      ['9', 'ok', null],
      ['10', 'ok', null],
      ['11', 'ok', null],
      ['12', 'ok', null],
    ])
    expect(card).toMatchObject({
      lead: '6 of 11 sections ready',
      next: null,
      cta: { label: 'Open Generation', link: { tab: 'generate' } },
      key: [
        { state: 'ok', label: 'Drafted' },
        { state: 'question', label: 'Questions for You' },
        { state: 'figures', label: 'Needs Your Figures' },
        { state: 'wait', label: 'Out of Date' },
        { state: 'new', label: 'Not Drafted' },
      ],
    })
    expect(card.type === 'outline' && card.items[6].link).toEqual({
      tab: 'generate',
      params: { section: '8' },
    })
    // How many are drafted is the greeting's to say; the outline's words don't repeat it.
    expect(opened.added[0].says[0].text).toMatch(/with 9 of 11 sections drafted\.$/)
    expect(opened.added[1].says[0].text).toBe(
      'Of the 11 sections, 6 are clean, 1 came back with questions for you, 1 is waiting on figures only you can enter, 1 is out of date, and 2 are not drafted yet.',
    )
    expect(view(opened, gen).status).toEqual({
      text: '5 sections to do',
      tone: 'amber',
      icon: 'sparkles',
    })
  })

  it('says all clear with a card of ticks when nothing is open (C13)', () => {
    const clear = brief({
      areas: AREAS.map((a) => ({ ...a, covered: a.total, thin: false, open: [] })),
      coverage: { ...NO_COVERAGE, status: 'done' },
      facts: facts({ observations: 31, walksReviewed: 1, recordingsTranscribed: 12 }),
    })
    const opened = run(EMPTY, clear, { type: 'open' }, new Date('2026-11-14T08:40:00Z'))
    expect(topics(opened.added)).toEqual(['greeting', 'all-clear'])
    expect(rowsOf(opened.added[1].cards[0]).map((r) => [r.title, r.detail])).toEqual([
      ['Site Walks', '1 reviewed'],
      ['Recordings', '12 transcribed'],
      ['Checklist', '42 of 42 answered'],
      ['Gaps', 'None found'],
    ])
    const shown = view(opened, clear)
    expect([shown.status.text, shown.mood, shown.replies]).toEqual(['All caught up', 'pleased', []])
  })

  it('shows an admin lanes and time in each stage, with nothing to answer (S9)', () => {
    const sections: SectionState[] = [
      {
        sectionId: '7',
        title: 'Construction',
        state: 'decisions',
        date: '2026-11-27',
        openComments: 2,
      },
      {
        sectionId: '2',
        title: 'Executive Summary',
        state: 'not_started',
        date: '2026-11-27',
        openComments: 0,
      },
      {
        sectionId: '3',
        title: 'Opportunities for Improvement',
        state: 'reviewed',
        date: '2026-11-28',
        openComments: 0,
      },
    ]
    const review = brief({
      stage: 'review',
      sections,
      facts: facts({
        reportDue: '2026-12-18',
        stageDates: {
          ...facts().stageDates,
          ready_for_generation: '2026-11-16T01:00:00.000Z',
          generate: '2026-11-24T01:00:00.000Z',
          review: '2026-11-25T01:00:00.000Z',
        },
      }),
    })
    const shown = adminThread(review, 'Sana Patel', new Date('2026-12-01T03:00:00Z'))
    expect(shown).toMatchObject({ viewer: 'admin', replies: [], earlier: [], thinking: false })
    expect(shown.status).toEqual({ text: "Alex's assessment", tone: 'blue', icon: 'user' })
    const [turn] = shown.session.turns
    expect(turn.says[0].text).toBe(
      "Hi Sana! This one is Alex Rowe's. It's in the Review stage: 1 of 3 sections are reviewed, and the report is due on 18 Dec 2026. Construction has 2 open comments.",
    )
    expect(turn.cards.map((c) => c.type)).toEqual(['lanes', 'stage-time'])
    expect(
      turn.cards[0].type === 'lanes' && turn.cards[0].lanes.map((l) => l.items.map((i) => i.date)),
    ).toEqual([[null], ['Drafted 27 Nov'], ['28 Nov']])
    expect(turn.cards[0].type === 'lanes' && turn.cards[0].lanes.map((l) => l.label)).toEqual([
      'Decisions to Make',
      'Not Started',
      'Reviewed',
    ])
    expect(turn.cards[1]).toMatchObject({ title: 'Time in Each Stage' })

    // Only lanes with sections; with none open, no lanes card at all (round 6).
    const someDone = adminThread(
      brief({ stage: 'review', sections: [sections[0], sections[2]] }),
      'Sana Patel',
      new Date('2026-12-01T03:00:00Z'),
    ).session.turns[0].cards[0]
    expect(someDone.type === 'lanes' && someDone.lanes.map((l) => l.label)).toEqual([
      'Decisions to Make',
      'Reviewed',
    ])
    const allDone = adminThread(
      brief({ stage: 'review', sections: [sections[2]] }),
      'Sana Patel',
      new Date('2026-12-01T03:00:00Z'),
    )
    expect(allDone.session.turns[0].cards.map((c) => c.type)).toEqual(['stage-time'])
  })
})

describe('round 6 and the review ledger', () => {
  it('ticks a card in place when its last row is fixed, instead of freezing it (ledger #2)', () => {
    const tidyItem = (id: string, resolvedAt: string | null = null) =>
      item(id, 'uncategorised', 'gap', { title: id, resolvedAt })
    const fine = AREAS.map((a) => ({ ...a, covered: a.total, thin: false, open: [] }))
    const open = brief({ areas: fine, items: [tidyItem('uncategorised')] })
    const first = run(EMPTY, open, { type: 'open' })
    expect(topics(first.added)).toEqual(['greeting', 'tidy'])
    expect(first.added[1].cards[0]).toMatchObject({ title: 'To Tidy Up' })
    const fixed = brief({ areas: fine, items: [tidyItem('uncategorised', LATER.toISOString())] })
    const card = view(first, fixed, LATER).session.turns[1].cards[0]
    expect(rowsOf(card)).toMatchObject([
      { id: 'uncategorised', tone: 'green', bad: false, end: { type: 'tick' } },
    ])
    // The same card ids, so a stored program still draws it.
    expect(card.id).toBe(first.added[1].cards[0].id)
  })

  it('stops offering "Generate anyway" once nothing blocks, and posts the ready card (ledger #2, #5)', () => {
    const thin = item('section.thin:9', 'thin-sections', 'gap', { title: 'Fire Protection' })
    const ready = (items: BriefItem[]) => brief({ stage: 'ready_for_generation', items })
    const first = run(EMPTY, ready([thin]), { type: 'open' })
    expect(topics(first.added)).toEqual(['greeting', 'before-generate'])
    expect(view(first, ready([thin])).replies.map((r) => r.id)).toEqual(['generate-anyway'])
    const before = first.added[1].cards[0]
    expect(before.type === 'rows' && before.ticks.map((t) => [t.title, t.bar])).toEqual([
      ['Site Walks', null],
      ['Recordings', null],
      ['Checklist', null],
    ])
    const cleared = run(first, ready([]), { type: 'changed' }, LATER)
    expect(topics(cleared.added)).toEqual(['ready'])
    const shown = view(cleared, ready([]), LATER)
    expect(shown.replies).toEqual([])
    expect(shown.status.text).toBe('Ready to generate')
  })

  it('asks about the export once a section changes after it, with the cards then the question (S8, ledger #5)', () => {
    const exported = (items: BriefItem[]) =>
      brief({
        stage: 'exported',
        items,
        facts: facts({
          exportDay: '2026-11-14',
          exportedAt: '2026-11-14T02:00:00.000Z',
          exportFile: { fileName: 'RPT-2026-0072 Pasir Gudang Cold Store.docx', pages: 38 },
        }),
      })
    const first = run(EMPTY, exported([]), { type: 'open' })
    expect(topics(first.added)).toEqual(['greeting', 'exported'])
    expect(view(first, exported([])).status.text).toBe('Exported')
    const stale = item('exported.stale', 'stale-export', 'info', { facts: { changed: '9' } })
    const asked = run(first, exported([stale]), { type: 'changed' }, LATER)
    expect(topics(asked.added)).toEqual(['exported', 'question'])
    expect(asked.added[0].cards.map((c) => [c.type, c.type === 'rows' && c.title])).toEqual([
      ['rows', 'Changed Since Export'],
      ['rows', 'Exported'],
    ])
    expect(rowsOf(asked.added[0].cards[1])[0].detail).toBe('38 pages')
    expect(asked.added[1].says[0].text).toBe('Do you want to export the newer one?')
    const shown = view(asked, exported([stale]), LATER)
    expect(shown.status.text).toBe('1 question for you')
    expect(shown.replies.map((r) => r.id)).toEqual(['not-now', 'export-again'])
  })

  it('says a place once, with the count, when two recordings from it fail (live defect 3b)', () => {
    const second = {
      ...recording('failed'),
      id: 'capture.failed-recording:o1:r2',
      actionTarget: 'o1:r2',
    }
    const both = brief({ items: [recording('failed'), second] })
    const first = run(EMPTY, both, { type: 'open' })
    expect(first.added[1].says[1].text).toBe(
      "2 recordings from Loading Bay 2 couldn't be transcribed. That's usually a hiccup on our side, so give them another try and I'll tell you how it goes.",
    )
    const again = brief({
      items: [recording('failed', 2), { ...second, facts: { ...second.facts, attempts: 2 } }],
    })
    const sorry = run(first, again, { type: 'changed' }, LATER)
    expect(topics(sorry.added)).toEqual(['sorry'])
    expect(sorry.added[0].says[0].text).toMatch(
      /^Sorry, Alex\. 2 recordings from Loading Bay 2 still wouldn't transcribe\./,
    )
  })

  it("doesn't repeat the greeting's words (live defects 3a, 3c)", () => {
    const fine = AREAS.map((a) => ({ ...a, covered: a.total, thin: false, open: [] }))
    const clear = run(EMPTY, brief({ areas: fine }), { type: 'open' })
    expect(clear.added[1].says[0].text).not.toMatch(/Capture stage/)
    const prepare = brief({
      stage: 'prepare',
      facts: facts({ surveyStart: '2026-11-16', surveyEnd: '2026-11-16', captureStarted: false }),
      items: [
        item('prepare.checklist-read', 'checklist-read', 'reminder', {
          link: { tab: 'checklist' },
        }),
      ],
    })
    const opened = run(EMPTY, prepare, { type: 'open' })
    expect(
      opened.added
        .map((t) => t.says.map((x) => x.text).join(' '))
        .join(' ')
        .match(/in 2 days/g),
    ).toHaveLength(1)
    expect(opened.added[1].cards[0]).toMatchObject({ title: 'Before the Survey' })
  })

  it('claims only what is sorted now in a catch-up (live defect 4)', () => {
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const MONDAY = new Date('2026-11-16T01:05:00Z')
    // One morning walk was reviewed; another, with the same name, is still waiting.
    const another = { ...walk(), id: 'walk.ready:w2' }
    const later = brief({ items: [walk('2026-11-15T03:00:00.000Z'), another, recording('failed')] })
    const text = run(first, later, { type: 'open' }, MONDAY).added[0].says[0].text
    expect(text).not.toMatch(/morning walk/)
  })

  it('claims nothing as sorted when the last session only skipped (live RPT-2026-0072)', () => {
    // Saturday: the walk and the recording were raised, and only "Skip for now" was pressed.
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const skipped = run(first, SURVEY, { type: 'reply', reply: 'skip' }, LATER)
    // The brief also keeps the walk's "complete the fields" gap, resolved during that
    // session: same title, "Morning walk", as the walk still waiting for review.
    const fields = item('walk.fields:w1', 'walk-fields', 'gap', {
      title: 'Morning walk',
      resolvedAt: new Date(LATER.getTime() + 60_000).toISOString(),
    })
    const monday = brief({ items: [walk(), recording('failed'), fields] })
    const next = run(skipped, monday, { type: 'open' }, new Date('2026-11-16T01:05:00Z'))
    expect(next.added[0].says[0].text).toBe(
      'Good morning, Alex! Pasir Gudang Cold Store is in the Capture stage, with 18 observations so far.',
    )
    expect(topics(next.added)).toEqual(['greeting', 'todo'])
  })

  it("starts the day's session for a reply sent the next morning (ledger #11)", () => {
    const MONDAY = new Date('2026-11-16T01:05:00Z')
    const first = run(EMPTY, SURVEY, { type: 'open' })
    const next = run(first, SURVEY, { type: 'reply', reply: 'skip' }, MONDAY)
    expect(next.earlier).toHaveLength(1)
    expect(topics(next.session!.turns)).toEqual(['reply', 'answer', 'checklist'])
  })

  it('sends an empty key when every outline item is in the same state (live defect 5)', () => {
    const all = (['2', '3', '4'] as const).map((no) => ({
      sectionId: no,
      title: `Section ${no}`,
      state: 'reviewed' as const,
      date: null,
      openComments: 0,
    }))
    const opened = run(EMPTY, brief({ stage: 'ready_to_export', sections: all }), { type: 'open' })
    expect(opened.added[1].cards[0]).toMatchObject({
      type: 'outline',
      key: [],
      next: null,
      cta: { label: 'Export the Report', link: { tab: 'export' } },
    })
  })

  it('keeps every status pill within 18 characters', () => {
    const texts = [
      view(run(EMPTY, SURVEY, { type: 'open' }), SURVEY).status.text,
      adminThread(
        brief({ facts: facts({ engineerName: 'Bartholomew Christensen' }) }),
        'Sana',
        SURVEY_DAY,
      ).status.text,
      view(
        run(
          EMPTY,
          brief({
            stage: 'review',
            sections: Array.from({ length: 11 }, (_, n) => ({
              sectionId: String(n + 2),
              title: `S${n}`,
              state: 'not_started' as const,
              date: null,
              openComments: 0,
            })),
          }),
          { type: 'open' },
        ),
        brief({
          stage: 'review',
          sections: Array.from({ length: 11 }, (_, n) => ({
            sectionId: String(n + 2),
            title: `S${n}`,
            state: 'not_started' as const,
            date: null,
            openComments: 0,
          })),
        }),
      ).status.text,
    ]
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(18)
    expect(texts[2]).toBe('11 to review')
  })
})
