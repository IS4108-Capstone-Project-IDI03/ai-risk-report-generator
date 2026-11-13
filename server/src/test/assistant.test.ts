// MarshBot's API (AS-06 test seam 1): the saved conversation for a seeded
// assessment, stages that only move forward, replies, another visit,
// dismissals, the admin's view, the export hook and the stage migration.
// rag-service is faked (assistant-fixtures.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantActivityModel } from '../models/assistant-activity.model'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { AssistantThreadModel } from '../models/assistant-thread.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { settleBackground } from '../services/assistant/background'
import { recordExport } from '../services/assistant/brief.service'
import { oneAtATime } from '../services/assistant/lock'
import { recheckAssessment, refreshBrief } from '../services/assistant/recheck.service'
import type { AssistantThread, Card, Reply } from '../services/assistant/types'
import { drainInlineJobs } from '../services/job-queue.service'
import { migrateStages } from '../scripts/migrate-stages'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  checklist,
  observation,
  people,
  readyWalk,
  rag,
  REF,
  session,
  stubRag,
} from './assistant-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const url = `/api/assessments/${REF}/assistant`
// 10:00 in Singapore on the survey day.
const SURVEY_DAY = new Date('2026-11-14T02:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SURVEY_DAY)
  stubRag()
})
afterEach(async () => {
  // Nothing may write after the collections are emptied.
  await drainInlineJobs()
  await settleBackground()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Api = ReturnType<typeof signedInAs>
const thread = (res: { body: unknown }) => res.body as AssistantThread
// The conversation once the new turns are worded (they are hidden while pending).
async function opened(api: Api): Promise<AssistantThread> {
  await api.get(url)
  await settleBackground()
  return thread(await api.get(url))
}
const topics = (t: AssistantThread) => t.session.turns.map((x) => x.topic)
const said = (t: AssistantThread) => t.session.turns.map((x) => x.says.map((s) => s.text).join(' '))
const rows = (cards: Card[]) =>
  cards.flatMap((c) => (c.type === 'tasks' || c.type === 'rows' ? c.rows : []))
const openItems = async () =>
  ((await AssistantBriefModel.findOne({ reference: REF }).lean())?.items ?? [])
    .filter((i) => !i.resolvedAt)
    .map((i) => i.id)

// Presses "What else?" until the choices offer `id`; returns the conversation then.
async function untilOffered(api: Api, id: Reply['id']): Promise<AssistantThread> {
  let t = await opened(api)
  for (let n = 0; n < 5 && !t.replies.some((r) => r.id === id); n++) {
    expect(t.replies.map((r) => r.id)).toContain('what-else')
    await api.post(`${url}/replies`).send({ replyId: 'what-else' })
    await settleBackground()
    t = thread(await api.get(url))
  }
  return t
}

describe('the conversation (AC 1)', () => {
  it('greets the engineer and raises the Fix now items of an assessment in Capture', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const s = await session(a._id)
    const failed = await observation(a._id, s._id, { failed: true })
    const walk = await readyWalk(a._id, engineer._id)
    const api = signedInAs(app, engineer)

    const first = await api.get(url)
    expect(first.status).toBe(200)
    // The new turns are being worded: the dots show, nothing to press yet.
    expect(thread(first)).toMatchObject({
      viewer: 'engineer',
      stage: 'capture',
      thinking: true,
      replies: [],
    })
    await settleBackground()
    const t = thread(await api.get(url))
    expect(t).toMatchObject({ mood: 'concerned', surveyStart: '2026-11-14', thinking: false })
    expect(t.status).toEqual({ text: '2 things to fix', tone: 'red', icon: 'circle-alert' })
    expect(topics(t)).toEqual(['greeting', 'todo'])
    expect(said(t)[0]).toBe(
      'Good morning, Alex! Pasir Gudang Cold Store is in the Capture stage, and you already have 1 observation in, which is a great start for survey day.',
    )
    const recording = `capture.failed-recording:${failed.id}:${failed.recordings[0]._id}`
    const todo = rows(t.session.turns[1].cards)
    expect(todo.map((r) => r.id)).toEqual(
      expect.arrayContaining([recording, `walk.ready:${walk.id}`]),
    )
    expect(todo.find((r) => r.id === recording)).toMatchObject({
      title: 'Loading Bay 2',
      detail: "Couldn't transcribe",
      end: { type: 'button', label: 'Try Again', action: 'retry-transcription' },
    })
    expect(t.replies.map((r) => r.id)).toEqual(['skip'])
    // Opening again adds nothing, and one thread is kept for the engineer.
    await settleBackground()
    expect(topics(thread(await api.get(url)))).toEqual(['greeting', 'todo'])
    expect(await AssistantThreadModel.countDocuments()).toBe(1)
  })

  it('refuses an engineer the assessment is not assigned to (403) and an unknown one (404)', async () => {
    const { engineer, colleague } = await people()
    await assessment(engineer._id)
    expect((await signedInAs(app, colleague).get(url)).status).toBe(403)
    expect(
      (await signedInAs(app, engineer).get('/api/assessments/RPT-0000/assistant')).status,
    ).toBe(404)
  })
})

describe('stages (AC 2, AC 4)', () => {
  it('moves forward on a reply and on new work, and never back', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const api = signedInAs(app, engineer)

    const first = await opened(api)
    expect(first.stage).toBe('setup')
    expect(first.replies).toEqual([
      {
        id: 'nothing-more',
        label: 'Nothing more to add',
        primary: true,
        picksDate: false,
        link: null,
        // It moves the stage, so the choice says where to (round 8).
        hint: "Clicking “Nothing more to add” will move the assessment's status forward to Prepare.",
      },
    ])

    const replied = await api.post(`${url}/replies`).send({ replyId: 'nothing-more' })
    expect(replied.status).toBe(200)
    expect(thread(replied).stage).toBe('prepare')
    expect(thread(replied).stageDates.prepare).toBe(SURVEY_DAY.toISOString())
    await settleBackground()
    const after = thread(await api.get(url))
    expect(after.session.turns.slice(3, 5).map((x) => [x.who, x.says[0].text])).toEqual([
      ['engineer', 'Nothing more to add'],
      ['bot', "Thanks! I've moved this on to the Prepare stage."],
    ])
    // Asked once: the same reply again is refused.
    expect((await api.post(`${url}/replies`).send({ replyId: 'nothing-more' })).status).toBe(409)

    const s = await session(a._id)
    expect(thread(await api.get(url)).stage).toBe('capture')
    await CaptureSessionModel.deleteOne({ _id: s._id })
    expect(thread(await api.get(url)).stage).toBe('capture')
    expect((await AssessmentModel.findById(a._id).lean())?.stage).toBe('capture')
  })

  it('takes a press when MarshBot only added its own turns since, and refuses an unknown turn (round 7, item 9; review #46)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    const first = await opened(api)
    const press = (lastTurnId: string) =>
      api.post(`${url}/replies`).send({ replyId: 'nothing-more', lastTurnId })
    // Not a turn of this session: refused, with the code the browser keys on (review #17).
    const unknown = await press('s0-1')
    expect([unknown.status, unknown.body]).toEqual([
      409,
      {
        error: 'MarshBot is not asking that right now. Reload the Overview.',
        code: 'reply-not-asked',
      },
    ])
    expect(thread(await api.get(url)).session.turns).toHaveLength(first.session.turns.length)
    // Only bot turns came after the one seen (e.g. a "sorry" turn): the question still stands.
    expect((await press(first.session.turns[0].id)).status).toBe(200)
  })

  it('refuses a second press once the engineer has answered, so it adds nothing (round 7, item 9; review #46)', async () => {
    vi.setSystemTime(new Date('2026-11-16T02:00:00Z'))
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await observation(a._id, (await session(a._id))._id, { categories: null })
    const api = signedInAs(app, engineer)
    const first = await opened(api)
    const seen = first.session.turns.at(-1)!.id
    const press = (replyId: Reply['id']) =>
      api.post(`${url}/replies`).send({ replyId, lastTurnId: seen })
    expect((await press('what-else')).status).toBe(200)
    await settleBackground()
    const after = thread(await api.get(url))
    // The next question is offered, but sent from the view before the engineer's own answer.
    expect(after.replies.map((r) => r.id)).toContain('ready-to-generate')
    const again = await press('ready-to-generate')
    expect([again.status, again.body.code]).toEqual([409, 'reply-not-asked'])
    expect(thread(await api.get(url)).session.turns).toHaveLength(after.session.turns.length)
  })

  it('records the export: Exported, with the file', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    await recordExport(REF, 'RPT-2026-0003 2026-11-14.pdf', 46)
    await settleBackground()
    const t = await opened(signedInAs(app, engineer))
    expect(t.stage).toBe('exported')
    expect(topics(t)).toEqual(['greeting', 'exported'])
    expect(t.session.turns[1].says[0]).toEqual({
      text: 'The Pasir Gudang Cold Store report went out on 14 Nov, 34 days before it was due.',
      tone: 'good',
    })
    expect(rows(t.session.turns[1].cards)[0]).toMatchObject({
      title: 'RPT-2026-0003 2026-11-14.pdf',
      detail: '46 pages',
    })
  })

  it('gives existing assessments a stage once (npm run migrate:stages)', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await session(a._id)
    await AssessmentModel.updateOne({ _id: a._id }, { $unset: { stage: 1 } })
    expect(await migrateStages()).toBe(1)
    expect((await AssessmentModel.findById(a._id).lean())?.stage).toBe('capture')
  })
})

describe('another site visit (AC 5)', () => {
  it('moves the survey end date, stays in Capture and quiets capture gaps', async () => {
    vi.setSystemTime(new Date('2026-11-16T02:00:00Z'))
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await observation(a._id, (await session(a._id))._id, { categories: null })
    const api = signedInAs(app, engineer)

    const before = await untilOffered(api, 'another-visit')
    expect(await openItems()).toContain('uncategorised')
    expect(said(before).at(-1)).toBe(
      "Sure! Your survey day has passed and you're at 1 observation now. There is just 1 question before I move this on to generation: is that everything from site, with all your observations recorded, or do you need another visit?",
    )

    expect((await api.post(`${url}/replies`).send({ replyId: 'another-visit' })).status).toBe(400)
    expect(
      (await api.post(`${url}/replies`).send({ replyId: 'another-visit', date: '2026-11-10' }))
        .status,
    ).toBe(400)
    const res = await api
      .post(`${url}/replies`)
      .send({ replyId: 'another-visit', date: '2026-11-20' })

    expect(res.status).toBe(200)
    expect(thread(res)).toMatchObject({ stage: 'capture', surveyEnd: '2026-11-20' })
    await settleBackground()
    const after = thread(await api.get(url))
    expect(said(after).slice(-2)).toEqual([
      'Another visit on Fri 20 Nov',
      "Done! The survey now ends on 20 Nov, and Pasir Gudang Cold Store stays in the Capture stage until then. I'll hold the gaps until you're back from site. Add whatever you gather on the day.",
    ])
    expect(after.status.text).toBe('Next visit booked')
    expect(await openItems()).not.toContain('uncategorised')
    expect((await AssessmentModel.findById(a._id).lean())?.siteVisitEndDate).toEqual(
      new Date('2026-11-20'),
    )
    // Not asked again until the visit has passed.
    expect((await api.post(`${url}/replies`).send({ replyId: 'ready-to-generate' })).status).toBe(
      409,
    )
  })
})

describe('who may reply, and archived assessments', () => {
  it('refuses a reply from an admin or a colleague (403); the dismiss route is gone', async () => {
    const { engineer, admin, colleague } = await people()
    await assessment(engineer._id)
    await opened(signedInAs(app, engineer))
    for (const user of [admin, colleague])
      expect(
        (await signedInAs(app, user).post(`${url}/replies`).send({ replyId: 'nothing-more' }))
          .status,
      ).toBe(403)
    expect(
      (await signedInAs(app, engineer).post(`${url}/dismissals`).send({ itemId: 'x' })).status,
    ).toBe(404)
  })

  it('opens an archived assessment read only: no session saved, no wording, nothing to answer', async () => {
    const { engineer } = await people()
    await assessment(engineer._id, { archivedAt: new Date() })
    const res = await signedInAs(app, engineer).get(url)
    await settleBackground()
    expect(res.status).toBe(200)
    expect(thread(res)).toMatchObject({ replies: [], thinking: false })
    expect(thread(res).status.text).toBe('Archived')
    expect(await AssistantThreadModel.countDocuments()).toBe(0)
    expect(rag.calls.filter((c) => c.path === '/assistant/wording')).toHaveLength(0)
    // A press on it is 409 without the not-asked code, so the browser can tell it apart (review #17).
    const press = await signedInAs(app, engineer)
      .post(`${url}/replies`)
      .send({ replyId: 'nothing-more' })
    expect([press.status, press.body]).toEqual([409, { error: `Assessment ${REF} is archived.` }])
  })
})

describe("an admin's view (AC 11)", () => {
  it('shows stage and progress only, with nothing saved and none of their activity kept', async () => {
    vi.setSystemTime(new Date('2026-11-12T02:00:00Z'))
    const { engineer, admin } = await people()
    const a = await assessment(engineer._id, { setupConfirmedAt: new Date() })
    await checklist(a._id, engineer._id)

    // The engineer, two days before the survey, hasn't read the checklist.
    const mine = await opened(signedInAs(app, engineer))
    expect(mine.stage).toBe('prepare')
    expect(await openItems()).toContain('prepare.checklist-read')

    const res = await signedInAs(app, admin).get(url)
    expect(res.status).toBe(200)
    const theirs = thread(res)
    expect(theirs).toMatchObject({ viewer: 'admin', stage: 'prepare', replies: [], earlier: [] })
    expect(theirs.status).toEqual({ text: "Alex's assessment", tone: 'blue', icon: 'user' })
    expect(said(theirs)).toEqual([
      "Hi Sana! This one is Alex Rowe's. It's in the Prepare stage: the report is due on 18 Dec 2026.",
    ])
    expect(theirs.session.turns[0].cards.map((c) => c.type)).toEqual(['stage-time'])
    expect(await AssistantThreadModel.countDocuments({ user: admin._id })).toBe(0)

    const activity = { places: [{ place: 'checklist', engagedMs: 5000, seen: {} }] }
    expect((await signedInAs(app, admin).post(`${url}/activity`).send(activity)).status).toBe(204)
    expect(await AssistantActivityModel.countDocuments()).toBe(0)
  })

  it('counts the engineer\'s reading: a read checklist turns the reminder into "you\'re set" (AC 8)', async () => {
    vi.setSystemTime(new Date('2026-11-12T02:00:00Z'))
    const { engineer } = await people()
    const a = await assessment(engineer._id, { setupConfirmedAt: new Date() })
    const list = await checklist(a._id, engineer._id)
    const api = signedInAs(app, engineer)
    const seen = { [String(list.items[0]._id)]: 2500 }
    expect(
      (
        await api
          .post(`${url}/activity`)
          .send({ places: [{ place: 'checklist', engagedMs: 3000, seen }] })
      ).status,
    ).toBe(204)
    const t = await opened(api)
    expect(await openItems()).toContain('prepare.checklist-ready')
    const before = t.session.turns.find((x) => x.topic === 'before-survey')!
    expect(before.says[0].text).toBe("You've read the checklist, so you're set.")
    expect(rows(before.cards)[0]).toMatchObject({
      title: 'Site Checklist',
      detail: 'Read through',
      end: { type: 'tick' },
    })
  })
})

describe('the session (#14)', () => {
  it("reading the conversation doesn't refresh the session cookie; a change does", async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    const read = await api.get(url)
    expect(read.status).toBe(200)
    expect(read.headers['set-cookie']).toBeUndefined()
    await settleBackground()
    const reply = await api.post(`${url}/replies`).send({ replyId: 'nothing-more' })
    expect(reply.headers['set-cookie']).toBeDefined()
  })
})

describe('the survey passed with nothing captured (#10, AC 5)', () => {
  it('asks about another visit in Prepare, and the visit moves it on to Capture', async () => {
    vi.setSystemTime(new Date('2026-11-16T02:00:00Z'))
    const { engineer } = await people()
    await assessment(engineer._id, { setupConfirmedAt: new Date() })
    const api = signedInAs(app, engineer)

    const before = await untilOffered(api, 'another-visit')
    expect(before.stage).toBe('prepare')
    expect(said(before).at(-1)).toBe(
      'Sure! Your survey day was on 14 Nov, and nothing is captured from it yet. Is that everything, or do you need another visit?',
    )

    const res = await api
      .post(`${url}/replies`)
      .send({ replyId: 'another-visit', date: '2026-11-20' })
    expect(res.status).toBe(200)
    expect(thread(res)).toMatchObject({ stage: 'capture', surveyEnd: '2026-11-20' })
    expect(await openItems()).not.toContain('prepare.survey-passed')
  })
})

describe('re-checks', () => {
  it('run one at a time per assessment, and side by side for different ones (#1)', async () => {
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const first = oneAtATime('A', async () => {
      order.push('A1 start')
      await held
      order.push('A1 end')
    })
    const second = oneAtATime('A', async () => void order.push('A2'))
    const other = oneAtATime('B', async () => void order.push('B'))
    await other
    expect(order).toEqual(['A1 start', 'B'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['A1 start', 'B', 'A1 end', 'A2'])
    // A failed one doesn't block the next.
    await expect(oneAtATime('A', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(oneAtATime('A', async () => 'ok')).resolves.toBe('ok')
  })

  it('throw a passing failure for the queue to retry, and skip an unknown assessment (#11)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const spy = vi
      .spyOn(AssistantBriefModel, 'findOne')
      .mockImplementationOnce(
        () => ({ lean: () => Promise.reject(new Error('Mongo blinked')) }) as never,
      )
    await expect(recheckAssessment(REF)).rejects.toThrow('Mongo blinked')
    spy.mockRestore()
    await expect(recheckAssessment('RPT-0000')).resolves.toBeUndefined()
  })

  it("keep a check's open items while rag-service can't be read (#12)", async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id, { readyToGenerateAt: new Date() })
    await session(a._id)
    const api = signedInAs(app, engineer)
    // Fire Protection needs 1 observation and has none.
    expect(thread(await api.get(url)).stage).toBe('ready_for_generation')
    expect(await openItems()).toContain('section.thin:9')

    rag.sections = () =>
      new Response(JSON.stringify({ detail: 'down' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    expect((await api.get(url)).status).toBe(200)
    expect(await openItems()).toContain('section.thin:9')
    const stored = await refreshBrief(REF)
    expect(stored?.items.find((i) => i.id === 'section.thin:9')?.resolvedAt).toBeNull()
  })
})

describe('activity with dotted keys (#46)', () => {
  it('keeps a finding key like 0.2 through the store and back to the checks', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    const seen = { '0.2': 1500, 'question:abc:1': 2500 }
    expect(
      (
        await api
          .post(`${url}/activity`)
          .send({ places: [{ place: 'section:7', engagedMs: 4000, seen }] })
      ).status,
    ).toBe(204)
    expect((await AssistantActivityModel.findOne({ assessment: a._id }).lean())?.seen).toEqual({
      '0%2E2': 1500,
      'question%3Aabc%3A1': 2500,
    })
    const { loadContext } = await import('../services/assistant/context')
    expect((await loadContext(REF))?.activity.get('section:7')?.seen).toEqual(seen)
    expect(await refreshBrief(REF)).not.toBeNull()
  })
})
