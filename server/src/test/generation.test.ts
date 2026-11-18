// Generation's one check and starting a drafting run (GN-13 test seam 1),
// through the gateway's routes. S4 is a stubbed fetch, so no paid call is made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { DraftingRunModel } from '../models/drafting-run.model'
import { ReportSectionModel } from '../models/report-section.model'
import { drainInlineJobs } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  doTasks,
  everyCategory,
  fakeS4,
  observation,
  people,
  REF,
} from './generation-fixtures'
import { useMemoryMongo } from './memory-mongo'

// MarshBot's re-check is AS-06's; here it only needs to run quietly.
vi.mock('../services/assistant/recheck.service', () => ({ recheckAssessment: vi.fn() }))

useMemoryMongo()

const url = `/api/assessments/${REF}/generation`
const STEP_ONE = ['3', '6', '7', '8', '9', '10', '11', '12']

beforeEach(() => {
  fakeS4()
})
afterEach(() => vi.unstubAllGlobals())

// The engineer's and the admin's sessions, and the assessment.
async function setup() {
  const { engineer, admin } = await people()
  const ids = await assessment(engineer._id)
  return { api: signedInAs(app, engineer), admin: signedInAs(app, admin), ids }
}

// Drafts what the checkpoint offers, in the background, and waits for it.
async function draftNow(api: ReturnType<typeof signedInAs>) {
  await api.post(`${url}/run`).expect(202)
  await drainInlineJobs()
}

// Makes Section 7's draft out of date: it now reads as drafted from no observations.
const outdateSectionSeven = () =>
  ReportSectionModel.updateOne({ sectionId: '7' }, { $set: { evidence: [] } })

describe('the checkpoint', () => {
  it('points out the sections with no observation, and drafting cannot start (AC2)', async () => {
    const { api, ids } = await setup()
    await observation(ids, ['Construction'])

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toEqual({
      kind: 'needs_observations',
      sections: ['8', '9', '10', '11', '12'],
    })
    const counts = Object.fromEntries(body.parts.map((p: never) => [p['id'], p['observations']]))
    expect(counts).toMatchObject({ '3': 1, '6': 1, '7': 1, '8': 0, '4': null, '2': null })
    await api.post(`${url}/run`).expect(409)
  })

  it('waits for recordings still transcribing (AC2)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await observation(ids, ['Protection'], { transcribing: true })

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toEqual({ kind: 'transcribing', recordings: 1, parts: STEP_ONE })
  })

  it('is ready to draft the 8 sections of step 1 once each has an observation (AC1)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toEqual({ kind: 'ready', step: 1, parts: STEP_ONE })
    expect(body).toMatchObject({ canStart: true, drafted: 0 })
    expect(body.parts.map((p: { id: string }) => p.id)).toEqual([...STEP_ONE, '4', '5', '2'])
    expect(body.steps).toEqual({
      one: { state: 'now', draftedAt: null, parts: STEP_ONE },
      two: { state: 'next' },
      three: { state: 'next', draftedAt: null, parts: ['4', '5', '2'] },
    })
  })

  it('needs the engineer once step 1 is drafted (AC4)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toEqual({ kind: 'input_needed' })
    expect(body.drafted).toBe(8)
    expect(body.tasks.map((t: { done: boolean }) => t.done)).toEqual([false, false, false])
    expect(body.steps.one.state).toBe('done')
    expect(body.steps.one.draftedAt).toEqual(expect.any(String))
    expect(body.steps.two).toEqual({ state: 'now' })
  })

  it('redrafts an out-of-date section first when ready for step 3 (AC5, AC6)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await doTasks(ids.id)
    await outdateSectionSeven()

    const { body } = await api.get(url).expect(200)

    expect(body.checkpoint).toEqual({ kind: 'ready', step: 3, parts: ['7', '4', '5', '2'] })
    expect(body.tasks.every((t: { done: boolean }) => t.done)).toBe(true)
    expect(body.parts.find((p: { id: string }) => p.id === '7').outOfDate).toEqual({
      why: 'observations',
    })
    expect(body.steps.three).toEqual({
      state: 'now',
      draftedAt: null,
      parts: ['7', '4', '5', '2'],
    })
  })

  it('says the report is drafted once all 11 are, then which are out of date (AC6, AC9)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    await doTasks(ids.id)
    await draftNow(api)

    const drafted = (await api.get(url).expect(200)).body
    expect(drafted.checkpoint).toEqual({ kind: 'drafted' })
    expect(drafted.drafted).toBe(11)
    expect(drafted.steps.three.state).toBe('done')

    await outdateSectionSeven()
    const { body } = await api.get(url).expect(200)
    expect(body.checkpoint).toEqual({ kind: 'out_of_date', parts: ['7', '2'] })
    expect(body.parts.find((p: { id: string }) => p.id === '2').outOfDate).toEqual({
      why: 'section',
      section: '7',
    })
  })
})

describe("Section 3's out-of-date check", () => {
  const sectionThree = async (api: ReturnType<typeof signedInAs>) =>
    (await api.get(url).expect(200)).body.parts.find((p: { id: string }) => p.id === '3')

  it('marks Section 3 out of date when an observation is added after OFIs were suggested', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await draftNow(api)
    expect((await sectionThree(api)).outOfDate).toBeNull()

    await observation(ids, ['Protection'], { note: 'Another finding.' })

    expect((await sectionThree(api)).outOfDate).toEqual({ why: 'observations' })
  })

  it('gives OFIs drafted before GN-13 a baseline on first read, then sees a change', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await api.post(`/api/assessments/${REF}/ofis/draft`).expect(201)

    expect((await sectionThree(api)).outOfDate).toBeNull()
    const record = await DraftingRunModel.findOne({ reference: REF }).lean()
    expect(record!.ofiEvidence).toEqual(expect.any(String))
    expect(record!.metadata).toMatchObject({ source_type: 'drafting_run', jurisdiction: 'SG' })

    await observation(ids, ['Protection'], { note: 'Another finding.' })
    expect((await sectionThree(api)).outOfDate).toEqual({ why: 'observations' })
  })

  it('saves one baseline when two reads come at once', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    await api.post(`/api/assessments/${REF}/ofis/draft`).expect(201)

    const reads = await Promise.all([api.get(url), api.get(url), api.get(url)])

    expect(reads.map((r) => r.status)).toEqual([200, 200, 200])
    expect(await DraftingRunModel.countDocuments({ reference: REF })).toBe(1)
  })
})

describe('starting a drafting run', () => {
  it('records the run with its parts in order and shows it drafting (AC3)', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    // S4 holds every answer until released, so the run is caught mid-way.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    fakeS4(() => held.then(() => undefined))

    const { body } = await api.post(`${url}/run`).expect(202)

    expect(body.checkpoint).toMatchObject({ kind: 'drafting', step: 1, parts: STEP_ONE })
    const record = await DraftingRunModel.findOne({ reference: REF }).lean()
    expect(record!.run).toMatchObject({ parts: STEP_ONE, finishedAt: null })
    expect(record!.parts!['9']).toMatchObject({
      action: 'draft',
      requestedBy: { name: 'Alex Rowe', role: 'risk_engineer' },
    })
    expect(record!.metadata).toMatchObject({ source_type: 'drafting_run', COPE_dimension: 'all' })
    // A second press while it runs is refused.
    await api.post(`${url}/run`).expect(409)

    release()
    await drainInlineJobs()
    expect((await api.get(url).expect(200)).body.checkpoint).toEqual({ kind: 'input_needed' })
  })

  it('starts once when pressed twice at the same moment', async () => {
    const { api, ids } = await setup()
    await everyCategory(ids)
    const s4 = fakeS4()

    const presses = await Promise.all([api.post(`${url}/run`), api.post(`${url}/run`)])
    await drainInlineJobs()

    expect(presses.map((r) => r.status).sort()).toEqual([202, 409])
    const asked = s4.calls.map((c) => String(c.body.section_id ?? c.route)).sort()
    expect(asked).toEqual(['/ofis/draft', '10', '11', '12', '6', '7', '8', '9'].sort())
  })

  it('lets only the assigned engineer start; an admin watches (AC11)', async () => {
    const { admin, ids } = await setup()
    await everyCategory(ids)

    await admin.post(`${url}/run`).expect(403)
    const { body } = await admin.get(url).expect(200)

    expect(body.canStart).toBe(false)
    expect(body.checkpoint.kind).toBe('ready')
    expect(await DraftingRunModel.countDocuments()).toBe(0)
  })
})
