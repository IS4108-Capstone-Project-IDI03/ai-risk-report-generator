// MarshBot's brief API (AS-06 test seam 1): the brief for a seeded assessment,
// stages that only move forward, another visit, dismissals, the admin's view,
// the export hook and the stage migration. rag-service is faked (assistant-fixtures.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantActivityModel } from '../models/assistant-activity.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { settleBackground } from '../services/assistant/background'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { recordExport } from '../services/assistant/brief.service'
import { oneAtATime, recheckAssessment, refreshBrief } from '../services/assistant/recheck.service'
import type { AssistantBrief } from '../services/assistant/types'
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

const brief = (res: { body: unknown }) => res.body as AssistantBrief
const ids = (b: AssistantBrief) => b.items.map((i) => i.id)

describe('the brief (AC 1)', () => {
  it('greets the engineer and lists the Fix now items of an assessment in Capture', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const s = await session(a._id)
    const failed = await observation(a._id, s._id, { failed: true })
    const walk = await readyWalk(a._id, engineer._id)

    const res = await signedInAs(app, engineer).get(url)

    expect(res.status).toBe(200)
    const b = brief(res)
    expect(b).toMatchObject({
      viewer: 'engineer',
      stage: 'capture',
      mood: 'concerned',
      surveyStart: '2026-11-14',
    })
    const recording = `capture.failed-recording:${failed.id}:${failed.recordings[0]._id}`
    expect(ids(b)).toEqual(expect.arrayContaining([recording, `walk.ready:${walk.id}`]))
    const fix = b.items.find((i) => i.id === recording)!
    expect(fix).toMatchObject({
      weight: 'fix_now',
      dismissible: false,
      action: 'retry-transcription',
      title: 'Loading Bay 2',
    })
    expect(fix.fact).toBe("A recording from Loading Bay 2 couldn't be transcribed.")
    expect(b.messages[0].text).toMatch(
      /^Morning, Alex\. Pasir Gudang Cold Store is in Capture, with 1 observation so far\. Two things to fix first\.$/,
    )
    expect(b.messages[1].parts).toEqual([
      { type: 'actions', itemIds: expect.arrayContaining([recording, `walk.ready:${walk.id}`]) },
    ])
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

    const first = brief(await api.get(url))
    expect(first.stage).toBe('setup')
    expect(first.messages.find((m) => m.id.startsWith('setup-question'))?.parts[0]).toMatchObject({
      type: 'replies',
      replies: [{ id: 'nothing-more' }],
    })

    const replied = await api.post(`${url}/replies`).send({ replyId: 'nothing-more' })
    expect(replied.status).toBe(200)
    expect(brief(replied).stage).toBe('prepare')
    expect(brief(replied).stageDates.prepare).toBe(SURVEY_DAY.toISOString())
    expect(brief(replied).thread.map((t) => t.who)).toEqual(['bot', 'engineer', 'bot'])
    // Asked once: the same reply again is refused.
    expect((await api.post(`${url}/replies`).send({ replyId: 'nothing-more' })).status).toBe(409)

    const s = await session(a._id)
    expect(brief(await api.get(url)).stage).toBe('capture')
    await CaptureSessionModel.deleteOne({ _id: s._id })
    expect(brief(await api.get(url)).stage).toBe('capture')
    expect((await AssessmentModel.findById(a._id).lean())?.stage).toBe('capture')
  })

  it('records the export: Exported, with the file', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    await recordExport(REF, 'RPT-2026-0003 2026-11-14.pdf', 46)
    await settleBackground()
    const b = brief(await signedInAs(app, engineer).get(url))
    expect(b.stage).toBe('exported')
    expect(b.export).toMatchObject({ fileName: 'RPT-2026-0003 2026-11-14.pdf', pages: 46 })
    expect(b.messages[0]).toMatchObject({ tone: 'success', parts: [{ type: 'file' }] })
    expect(b.messages[0].text).toMatch(
      /^Nice work, Alex\. The report went out on 14 Nov 2026, 34 days before it was due\./,
    )
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

    const before = brief(await api.get(url))
    expect(ids(before)).toContain('uncategorised')
    expect(
      before.messages.find(
        (m) => m.text === 'Is that everything from site, or do you need another visit?',
      ),
    ).toBeDefined()

    expect((await api.post(`${url}/replies`).send({ replyId: 'another-visit' })).status).toBe(400)
    expect(
      (await api.post(`${url}/replies`).send({ replyId: 'another-visit', date: '2026-11-10' }))
        .status,
    ).toBe(400)
    const res = await api
      .post(`${url}/replies`)
      .send({ replyId: 'another-visit', date: '2026-11-20' })

    expect(res.status).toBe(200)
    const after = brief(res)
    expect(after).toMatchObject({ stage: 'capture', surveyEnd: '2026-11-20' })
    expect(ids(after)).not.toContain('uncategorised')
    expect(after.thread.at(-2)?.text).toBe('I need another visit on Fri 20 Nov 2026')
    expect(after.thread.at(-1)?.text).toMatch(/^Done\. The survey now ends on 20 Nov 2026/)
    expect((await AssessmentModel.findById(a._id).lean())?.siteVisitEndDate).toEqual(
      new Date('2026-11-20'),
    )
    // Not asked again until the visit has passed.
    expect((await api.post(`${url}/replies`).send({ replyId: 'ready-to-generate' })).status).toBe(
      409,
    )
  })

  it("repeats nothing of MarshBot's answer in the same visit (#53, board 05)", async () => {
    vi.setSystemTime(new Date('2026-11-16T02:00:00Z'))
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await observation(a._id, (await session(a._id))._id)
    const api = signedInAs(app, engineer)
    await api.get(url)

    const res = await api
      .post(`${url}/replies`)
      .send({ replyId: 'another-visit', date: '2026-11-20' })

    const keys = (b: AssistantBrief) => b.messages.map((m) => m.id.replace(/-[0-9a-f]{8}$/, ''))
    expect(keys(brief(res))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(greeting|visit-set|done)$/)]),
    )
    // Opened again later, it is a new visit: MarshBot greets again.
    vi.setSystemTime(new Date('2026-11-16T02:45:00Z'))
    expect(keys(brief(await signedInAs(app, engineer).get(url)))).toContain('greeting')
  })
})

describe('dismissals (AC 6)', () => {
  it('hides an item until it changes, and refuses a Fix now item', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const s = await session(a._id)
    const failed = await observation(a._id, s._id, { failed: true, categories: null })
    const api = signedInAs(app, engineer)
    await api.get(url)

    expect((await api.post(`${url}/dismissals`).send({ itemId: 'uncategorised' })).status).toBe(204)
    expect(ids(brief(await api.get(url)))).not.toContain('uncategorised')
    const fixNow = `capture.failed-recording:${failed.id}:${failed.recordings[0]._id}`
    expect((await api.post(`${url}/dismissals`).send({ itemId: fixNow })).status).toBe(409)
    expect((await api.post(`${url}/dismissals`).send({ itemId: 'no-such-item' })).status).toBe(404)

    // A second uncategorised observation changes the item's facts: it comes back.
    await observation(a._id, s._id, { categories: null })
    expect(ids(brief(await api.get(url)))).toContain('uncategorised')
  })
})

describe("an admin's view (AC 11)", () => {
  it('shows stage and progress only, with no reminders and none of their activity kept', async () => {
    vi.setSystemTime(new Date('2026-11-12T02:00:00Z'))
    const { engineer, admin } = await people()
    const a = await assessment(engineer._id, { setupConfirmedAt: new Date() })
    await checklist(a._id, engineer._id)

    // The engineer, two days before the survey, hasn't read the checklist.
    const mine = brief(await signedInAs(app, engineer).get(url))
    expect(mine.stage).toBe('prepare')
    expect(mine.items.find((i) => i.id === 'prepare.checklist-read')).toMatchObject({
      weight: 'reminder',
    })

    const res = await signedInAs(app, admin).get(url)
    expect(res.status).toBe(200)
    const theirs = brief(res)
    expect(theirs).toMatchObject({ viewer: 'admin', stage: 'prepare', items: [], thread: [] })
    expect(theirs.messages[0].text).toBe(
      "Hi Sana. This one is Alex Rowe's. It's in prepare: the report is due on 18 Dec 2026.",
    )
    expect(theirs.messages.flatMap((m) => m.parts).map((p) => p.type)).toEqual(['stage-time'])

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
    const b = brief(await api.get(url))
    expect(ids(b)).toContain('prepare.checklist-ready')
    expect(b.messages.find((m) => m.id.startsWith('checklist-ready'))?.text).toBe(
      "The survey is in two days and you've read the checklist, so you're set.",
    )
  })
})

describe('the session (#14)', () => {
  it("reading the brief doesn't refresh the session cookie; a change does", async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    const read = await api.get(url)
    expect(read.status).toBe(200)
    expect(read.headers['set-cookie']).toBeUndefined()
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

    const before = brief(await api.get(url))
    expect(before.stage).toBe('prepare')
    const question = before.messages.find((m) => m.id.startsWith('visit-question'))
    expect(question?.text).toBe(
      'Nothing is captured from the survey on 14 Nov 2026. Is that everything, or do you need another visit?',
    )

    const res = await api
      .post(`${url}/replies`)
      .send({ replyId: 'another-visit', date: '2026-11-20' })
    expect(res.status).toBe(200)
    expect(brief(res)).toMatchObject({ stage: 'capture', surveyEnd: '2026-11-20' })
    expect(ids(brief(res))).not.toContain('prepare.survey-passed')
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
    const before = brief(await api.get(url))
    expect(before.stage).toBe('ready_for_generation')
    expect(ids(before)).toContain('section.thin:9')

    rag.sections = () =>
      new Response(JSON.stringify({ detail: 'down' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    const during = brief(await api.get(url))
    expect(ids(during)).toContain('section.thin:9')
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
