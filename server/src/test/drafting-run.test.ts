// The drafting run's worker (GN-13 test seam 2): each part is drafted by the same
// drafting function as before, reaching S4 at the same route; retries, order,
// the bell, the guard against two drafts of one section, and restart recovery.
// S4 is a stubbed fetch, so no paid call is made. Jobs run inline under tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { DraftingRunModel } from '../models/drafting-run.model'
import { NotificationModel } from '../models/notification.model'
import { ReportSectionModel } from '../models/report-section.model'
import { UserModel } from '../models/user.model'
import { draftingQueue, resumeDraftingRuns } from '../services/generation/drafting-run.service'
import { sectionList } from '../services/generation/words'
import { drainInlineJobs, setInlineAttempts } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  doTasks,
  draftedIds,
  everyCategory,
  fakeS4,
  observation,
  OFI,
  people,
  REF,
  type S4Call,
} from './generation-fixtures'
import { useMemoryMongo } from './memory-mongo'

// MarshBot's re-check is AS-06's; here it only needs to run quietly.
vi.mock('../services/assistant/recheck.service', () => ({ recheckAssessment: vi.fn() }))

useMemoryMongo()

const url = `/api/assessments/${REF}/generation`
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// S4 failing one section every time it is asked.
const failing = (id: string) => (call: S4Call) =>
  call.body.section_id === id ? json({ detail: 'The model is overloaded.' }, 500) : undefined
const STEP_ONE = ['3', '6', '7', '8', '9', '10', '11', '12']
const NOT_QUEUED = 'Drafting could not be queued. Try again.'

let s4: ReturnType<typeof fakeS4>
beforeEach(() => {
  s4 = fakeS4()
})
afterEach(() => {
  setInlineAttempts(1)
  vi.unstubAllGlobals()
})

async function setup() {
  const { engineer, admin } = await people()
  const ids = await assessment(engineer._id)
  await everyCategory(ids)
  return { api: signedInAs(app, engineer), admin: signedInAs(app, admin), ids }
}

// S4 holding back the calls `held` picks until released; the rest answer as usual
// (or as `otherwise` says). Returns the release.
function holding(
  held: (call: S4Call) => boolean,
  otherwise: (call: S4Call) => Response | undefined = () => undefined,
) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  s4 = fakeS4((call) => (held(call) ? gate.then(() => undefined) : otherwise(call)))
  return release
}
const sectionCall = (id: string) => (call: S4Call) => call.body.section_id === id

// Waits until the part's latest job has the status.
const partReaches = (id: string, status: string) =>
  vi.waitFor(async () => {
    const record = await DraftingRunModel.findOne({ reference: REF }).lean()
    expect(record!.parts![id].status).toBe(status)
  })

// Starts the drafting run the checkpoint offers and waits for it to settle.
async function draftNow(api: ReturnType<typeof signedInAs>) {
  const { body } = await api.post(`${url}/run`).expect(202)
  await drainInlineJobs()
  return body
}

// The bell items made, oldest first, with their status.
const bell = async () =>
  (await NotificationModel.find({ purpose: 'drafting_status' }).sort({ _id: 1 }).lean()).map(
    (n) => ({ message: n.message, status: (n.context as Record<string, string>).status }),
  )

describe('a drafting run', () => {
  it('drafts each part through the same S4 route as before, Section 2 last', async () => {
    const { api, ids } = await setup()

    await draftNow(api)
    expect(draftedIds(s4.calls).sort()).toEqual(
      ['/ofis/draft', '10', '11', '12', '6', '7', '8', '9'].sort(),
    )
    expect(
      s4.calls.every((c) => (c.body.assessment as { reference: string }).reference === REF),
    ).toBe(true)

    await doTasks(ids.id)
    s4.calls.length = 0
    await draftNow(api)
    const order = draftedIds(s4.calls)
    expect(order.slice(0, 2).sort()).toEqual(['4', '5'])
    expect(order[2]).toBe('/summary/draft')
    expect(order).toHaveLength(3)
  })

  it('tries a failing part 3 times, then marks it failed while the others finish (AC7)', async () => {
    const { api } = await setup()
    setInlineAttempts(3)
    s4 = fakeS4(failing('9'))

    await draftNow(api)

    expect(draftedIds(s4.calls).filter((id) => id === '9')).toHaveLength(3)
    const { body } = await api.get(url).expect(200)
    expect(body.checkpoint).toEqual({ kind: 'failed', failed: ['9'], parts: ['9'] })
    expect(body.parts.find((p: { id: string }) => p.id === '9')).toMatchObject({
      drafted: false,
      job: 'failed',
      attempts: 3,
      error: 'The model is overloaded.',
    })
    expect(body.drafted).toBe(7)
    // AC8: the bell says what failed and what is ready.
    expect(await bell()).toEqual([
      { message: 'Section 9 was not drafted.', status: 'failed' },
      {
        message: 'Your draft of Sections 3, 6, 7, 8, 10, 11 and 12 is ready.',
        status: 'ready',
      },
    ])

    // Try again drafts just that part.
    s4 = fakeS4()
    expect((await draftNow(api)).checkpoint).toMatchObject({ kind: 'drafting', parts: ['9'] })
    expect((await api.get(url).expect(200)).body.checkpoint).toEqual({ kind: 'input_needed' })
  })

  it('leaves Section 2 undrafted when another part of the run failed', async () => {
    const { api, ids } = await setup()
    await draftNow(api)
    await doTasks(ids.id)
    s4 = fakeS4(failing('5'))

    await draftNow(api)

    expect(draftedIds(s4.calls)).not.toContain('/summary/draft')
    const { body } = await api.get(url).expect(200)
    expect(body.checkpoint).toEqual({ kind: 'failed', failed: ['5'], parts: ['5', '2'] })
    expect(body.parts.find((p: { id: string }) => p.id === '2')).toMatchObject({
      drafted: false,
      job: null,
    })
  })

  it('redrafts out-of-date parts first (AC6)', async () => {
    const { api, ids } = await setup()
    await draftNow(api)
    await doTasks(ids.id)
    await ReportSectionModel.updateOne({ sectionId: '7' }, { $set: { evidence: [] } })
    s4.calls.length = 0

    const started = await draftNow(api)

    expect(started.checkpoint).toMatchObject({
      kind: 'drafting',
      step: 3,
      parts: ['7', '4', '5', '2'],
    })
    expect(draftedIds(s4.calls).at(-1)).toBe('/summary/draft')
    expect(draftedIds(s4.calls).slice(0, 3).sort()).toEqual(['4', '5', '7'])
  })

  it('drafts Section 2 without OFIs when the AI suggested none (rule 5)', async () => {
    const { api, ids } = await setup()
    s4.ofis.list = []
    await draftNow(api)
    const { body } = await api.get(url).expect(200)
    expect(body.parts[0]).toMatchObject({ id: '3', drafted: true })
    expect(body.tasks[0]).toEqual({ id: 'ofi', section: '3', done: true })

    await doTasks(ids.id)
    await draftNow(api)

    expect(draftedIds(s4.calls)).toContain('/summary/draft')
    expect((await api.get(url).expect(200)).body.checkpoint).toEqual({ kind: 'drafted' })
  })
})

describe('a drafting run, its count and its tasks', () => {
  it('counts only drafted parts in "N of M", not a failed one', async () => {
    const { api } = await setup()
    const release = holding(sectionCall('7'), failing('9'))
    await api.post(`${url}/run`).expect(202)
    await partReaches('9', 'failed')
    await vi.waitFor(async () => {
      const parts = (await DraftingRunModel.findOne({ reference: REF }).lean())!.parts!
      expect(STEP_ONE.filter((id) => parts[id].status === 'done')).toHaveLength(6)
    })

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toMatchObject({ kind: 'drafting', done: 6 })
    release()
    await drainInlineJobs()
  })

  it('drops Section 2 when a redraft of Section 3 suggests OFIs where there were none', async () => {
    const { api, ids } = await setup()
    s4.ofis.list = []
    await draftNow(api)
    await doTasks(ids.id)
    // Section 3 is now out of date, and this time the AI suggests an OFI.
    await observation(ids, ['Construction'], { note: 'Another finding.' })
    s4.ofis.list = [OFI]
    s4.calls.length = 0

    const started = await draftNow(api)

    expect(started.checkpoint.parts).toEqual(expect.arrayContaining(['3', '2']))
    expect(draftedIds(s4.calls)).toContain('/ofis/draft')
    expect(draftedIds(s4.calls)).not.toContain('/summary/draft')
    const { body } = await api.get(url).expect(200)
    expect(body.checkpoint).toEqual({ kind: 'input_needed' })
    expect(body.parts.find((p: { id: string }) => p.id === '2')).toMatchObject({
      drafted: false,
      job: null,
    })
  })

  it('refuses the old Executive Summary route while Section 2 waits in a run', async () => {
    const { api, ids } = await setup()
    await draftNow(api)
    await doTasks(ids.id)
    const release = holding(sectionCall('4'))
    await api.post(`${url}/run`).expect(202)
    await partReaches('2', 'queued')

    await api.post(`/api/assessments/${REF}/summary/draft`).expect(409)

    release()
    await drainInlineJobs()
  })

  it('refuses a run on an archived assessment', async () => {
    const { api } = await setup()
    await AssessmentModel.updateOne({ reference: REF }, { $set: { archivedAt: new Date() } })

    await api.post(`${url}/run`).expect(409)
    expect(s4.calls).toHaveLength(0)
  })
})

describe('the queue being down', () => {
  it('fails the parts it could not queue and closes the run, so a new start works', async () => {
    const { api } = await setup()
    const down = vi.spyOn(draftingQueue, 'add').mockRejectedValue(new Error('redis down'))

    const { body } = await api.post(`${url}/run`).expect(202)
    down.mockRestore()

    expect(body.checkpoint).toEqual({ kind: 'failed', failed: STEP_ONE, parts: STEP_ONE })
    expect(body.parts.find((p: { id: string }) => p.id === '9')).toMatchObject({
      job: 'failed',
      error: NOT_QUEUED,
    })
    expect(
      (await DraftingRunModel.findOne({ reference: REF }).lean())!.run!.finishedAt,
    ).not.toBeNull()
    expect(s4.calls).toHaveLength(0)
    await draftNow(api)
    expect((await api.get(url).expect(200)).body.checkpoint).toEqual({ kind: 'input_needed' })
  })

  it('fails a part from Review it could not queue, with a bell item', async () => {
    const { api } = await setup()
    await draftNow(api)
    const down = vi.spyOn(draftingQueue, 'add').mockRejectedValue(new Error('redis down'))

    const { body } = await api.post(`${url}/parts/6`).send({}).expect(202)
    down.mockRestore()

    expect(body.parts.find((p: { id: string }) => p.id === '6')).toMatchObject({
      drafted: true,
      job: 'failed',
      error: NOT_QUEUED,
    })
    expect((await bell()).at(-1)).toEqual({
      message: 'Section 6 was not drafted.',
      status: 'failed',
    })
    await api.post(`${url}/parts/6`).send({}).expect(202)
    await drainInlineJobs()
  })

  it('fails Section 2 when it cannot be queued at the end of a run, and closes the run', async () => {
    const { api, ids } = await setup()
    await draftNow(api)
    await doTasks(ids.id)
    const add = draftingQueue.add
    const down = vi
      .spyOn(draftingQueue, 'add')
      .mockImplementation((id, data, delay) =>
        data.partId === '2' ? Promise.reject(new Error('redis down')) : add(id, data, delay),
      )

    await draftNow(api)
    down.mockRestore()

    expect(draftedIds(s4.calls)).not.toContain('/summary/draft')
    expect((await api.get(url).expect(200)).body.checkpoint).toEqual({
      kind: 'failed',
      failed: ['2'],
      parts: ['2'],
    })
    expect(
      (await DraftingRunModel.findOne({ reference: REF }).lean())!.run!.finishedAt,
    ).not.toBeNull()
  })
})

describe('the status write failing', () => {
  it('never drafts a part again after its "done" write fails', async () => {
    const { api } = await setup()
    await draftNow(api)
    setInlineAttempts(3)
    const update = DraftingRunModel.updateOne.bind(DraftingRunModel)
    const blink = vi
      .spyOn(DraftingRunModel, 'updateOne')
      .mockImplementation(((filter: never, change: { $set?: Record<string, unknown> }) =>
        change?.$set?.['parts.3.status'] === 'done'
          ? Promise.reject(new Error('Mongo blinked'))
          : update(filter, change as never)) as never)
    s4.calls.length = 0

    await api.post(`${url}/parts/3`).send({}).expect(202)
    await drainInlineJobs()
    blink.mockRestore()

    expect(draftedIds(s4.calls)).toEqual(['/ofis/draft'])
  })
})

describe('review decisions during a redraft', () => {
  const decide = (api: ReturnType<typeof signedInAs>, id: string, draftId: string) =>
    api.post(`/api/assessments/${REF}/sections/${id}/findings/0.0/accept`).send({ draftId })
  const savedDraft = async (id: string) =>
    String(
      (await ReportSectionModel.findOne({ sectionId: id, replacementFor: { $exists: false } })
        .sort({ _id: -1 })
        .lean())!._id,
    )

  it('refuses one while the section is redrafted, and takes it during a regenerate or once done', async () => {
    const { api, ids } = await setup()
    await draftNow(api)
    await doTasks(ids.id)
    await ReportSectionModel.updateOne({ sectionId: '7' }, { $set: { evidence: [] } })
    const before = await savedDraft('7')
    let release = holding(sectionCall('7'))
    await api.post(`${url}/run`).expect(202)

    const refused = await decide(api, '7', before).expect(409)
    expect(refused.body.error).toBe(
      "Section 7 is being redrafted. You can review it again when it's ready.",
    )
    await api
      .post(`/api/assessments/${REF}/sections/7/bulk-accept`)
      .send({ draftId: before })
      .expect(409)
    release()
    await drainInlineJobs()
    await decide(api, '7', await savedDraft('7')).expect(200)

    // A regenerate's replacement waits beside the saved draft, so decisions go on.
    release = holding(sectionCall('6'))
    await api.post(`${url}/parts/6`).send({}).expect(202)
    await decide(api, '6', await savedDraft('6')).expect(200)
    release()
    await drainInlineJobs()
  })
})

describe('one part from Review', () => {
  it('refuses a part of the drafting run still going, even once that part is drafted', async () => {
    const { api } = await setup()
    const release = holding(sectionCall('7'))
    await api.post(`${url}/run`).expect(202)
    await partReaches('6', 'done')

    const refused = await api.post(`${url}/parts/6`).send({}).expect(409)

    expect(refused.body.error).toBe('Drafting is still under way. Try again when it finishes.')
    release()
    await drainInlineJobs()
  })

  it('lets only the assigned engineer draft a part: an admin and another engineer get 403', async () => {
    const { api, admin } = await setup()
    await draftNow(api)
    const other = await UserModel.create({
      staffId: 'T-3',
      name: 'Lee Tan',
      email: 'lee@example.com',
      role: 'risk_engineer',
    })

    await admin.post(`${url}/parts/6`).send({}).expect(403)
    await signedInAs(app, other).post(`${url}/parts/6`).send({}).expect(403)
  })

  it('keeps Section 3 drafted with no OFIs while it is redrafted, then tells the bell', async () => {
    const { api } = await setup()
    s4.ofis.list = []
    await draftNow(api)
    const release = holding((call) => call.route === '/ofis/draft')
    s4.ofis.list = []

    await api.post(`${url}/parts/3`).send({}).expect(202)

    const { body } = await api.get(url).expect(200)
    expect(body.parts[0]).toMatchObject({ id: '3', drafted: true, draftedAt: expect.any(String) })
    expect(body.parts[0].job).not.toBeNull()
    expect(body.drafted).toBe(8)
    release()
    await drainInlineJobs()
    expect((await bell()).at(-1)).toEqual({
      message: 'Your new draft of Section 3 is ready.',
      status: 'ready',
    })
  })

  it('regenerates a section in the background as a replacement, and tells the bell (AC10)', async () => {
    const { api } = await setup()
    await api.post(`${url}/parts/6`).send({ instruction: null }).expect(409) // not drafted yet
    await draftNow(api)
    s4.calls.length = 0

    await api.post(`${url}/parts/6`).send({ instruction: 'Shorter.' }).expect(202)
    await drainInlineJobs()

    expect(s4.calls).toHaveLength(1)
    expect(s4.calls[0].body).toMatchObject({
      section_id: '6',
      redraft: { instruction: 'Shorter.' },
    })
    expect(
      await ReportSectionModel.countDocuments({
        sectionId: '6',
        replacementFor: { $exists: true },
      }),
    ).toBe(1)
    expect((await bell()).at(-1)).toEqual({
      message: 'Your new draft of Section 6 is ready.',
      status: 'ready',
    })
    // A replacement is waiting, so another regenerate is refused at once.
    await api.post(`${url}/parts/6`).send({}).expect(409)
  })

  it('never drafts a section a run is drafting (the guard)', async () => {
    const { api } = await setup()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    s4 = fakeS4(() => held.then(() => undefined))
    await api.post(`${url}/run`).expect(202)

    await api.post(`${url}/parts/7`).send({ instruction: null }).expect(409)
    await api.post(`${url}/parts/3`).send({}).expect(409)
    // The old synchronous routes too.
    await api.post(`/api/assessments/${REF}/sections/7/draft`).expect(409)
    await api.post(`/api/assessments/${REF}/sections/7/regenerate`).send({}).expect(409)
    await api.post(`/api/assessments/${REF}/ofis/draft`).expect(409)

    release()
    await drainInlineJobs()
    expect(draftedIds(s4.calls).filter((id) => id === '7')).toHaveLength(1)
    await api.post(`${url}/parts/7`).send({ instruction: null }).expect(202)
    await drainInlineJobs()
  })
})

describe('restart recovery', () => {
  it('finishes a part left drafting and one left queued, and drafts nothing twice', async () => {
    const { api } = await setup()
    await draftNow(api)
    // As if the gateway stopped mid-run.
    await DraftingRunModel.updateOne(
      { reference: REF },
      {
        $set: {
          'parts.7.status': 'drafting',
          'parts.8.status': 'queued',
          'run.parts': ['7', '8'],
          'run.finishedAt': null,
        },
      },
    )
    s4.calls.length = 0

    await resumeDraftingRuns()
    await drainInlineJobs()
    await resumeDraftingRuns()
    await drainInlineJobs()

    expect(draftedIds(s4.calls).sort()).toEqual(['7', '8'])
    const record = await DraftingRunModel.findOne({ reference: REF }).lean()
    expect([record!.parts!['7'].status, record!.parts!['8'].status]).toEqual(['done', 'done'])
    expect(record!.run!.finishedAt).not.toBeNull()
  })

  it('drafts again a part cut off mid-draft and closes its run', async () => {
    const { api } = await setup()
    await api.post(`${url}/run`).expect(202)
    await drainInlineJobs()
    // As if the gateway stopped while Section 3 was being drafted.
    await DraftingRunModel.updateOne(
      { reference: REF },
      { $set: { 'parts.3.status': 'drafting', 'run.parts': ['3'], 'run.finishedAt': null } },
    )
    s4.calls.length = 0

    await resumeDraftingRuns()
    await drainInlineJobs()

    expect(draftedIds(s4.calls)).toEqual(['/ofis/draft'])
    const record = await DraftingRunModel.findOne({ reference: REF }).lean()
    expect(record!.parts!['3'].status).toBe('done')
    expect(record!.run!.finishedAt).not.toBeNull()
  })
})

describe('the bell wording', () => {
  // The same table as the client's (client/src/features/assessments/generation/words.ts).
  it.each([
    [['3'], 'Section 3'],
    [['4', '5'], 'Sections 4 and 5'],
    [['9', '11'], 'Sections 9 and 11'],
    [['3', '6', '7', '8', '9', '10', '11', '12'], 'Section 3 and Sections 6 to 12'],
    [['6', '7', '8', '9', '10', '11', '12'], 'Sections 6 to 12'],
    [['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], 'Sections 3 to 12'],
    [['2', '4', '5'], 'Sections 2, 4 and 5'],
    [['7', '2'], 'Sections 2 and 7'],
    [['4', '5', '7'], 'Sections 4, 5 and 7'],
    [['3', '6', '8', '9', '11', '12'], 'Sections 3, 6, 8, 9, 11 and 12'],
    [['6', '7', '8', '10', '11', '12'], 'Sections 6 to 8 and Sections 10 to 12'],
  ])('names %j as "%s"', (ids, words) => {
    expect(sectionList(ids)).toBe(words)
  })
})
