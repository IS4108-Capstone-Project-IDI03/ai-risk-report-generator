// CP-24 test seams 1, 2 and 4: the gateway API for suggestions and draft
// observations (supertest, in-memory Mongo), the reading job with the rating
// and description calls stubbed, and the push to an open event stream.
// S3 is a map; S5 and rag-service are a stubbed fetch.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Types } from 'mongoose'
import { Readable } from 'stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { signSession } from '../services/auth.service'
import { evidenceFingerprint } from '../services/generation/generation.service'
import { drainInlineJobs, setInlineAttempts } from '../services/job-queue.service'
import { runReading } from '../services/observation-reading.service'
import {
  cleanupStaleDrafts,
  createWalkObservation,
  listObservations,
} from '../services/observation.service'
import { draftingEvidence } from '../services/section.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

const s3 = vi.hoisted(() => new Map<string, Buffer>())
// A spy, so a test can make one delete fail as a storage outage would.
const deleteObject = vi.hoisted(() => vi.fn(async (key: string) => void s3.delete(key)))
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  getObjectStream: async (key: string) => Readable.from([s3.get(key)]),
  deleteObject,
}))

// Runs `meanwhile` just before the next findOneAndUpdate reaches Mongo: a
// change landing between a service's read and its atomic write. Returns the
// spy, to restore once the race is run.
function beforeNextWrite(meanwhile: () => Promise<unknown>) {
  const original = ObservationModel.findOneAndUpdate.bind(ObservationModel)
  return vi.spyOn(ObservationModel, 'findOneAndUpdate').mockImplementationOnce(((
    ...args: Parameters<typeof original>
  ) => {
    const query = original(...args)
    const exec = query.exec.bind(query)
    query.exec = (async () => {
      await meanwhile()
      return exec()
    }) as typeof query.exec
    return query
  }) as typeof original)
}

type Body = Record<string, unknown>
const transcribe = vi.fn<(body: Body) => Promise<Response>>()
const describePhotos = vi.fn<(body: Body) => Promise<Response>>()
const rate = vi.fn<(body: Body) => Promise<Response>>()

useMemoryMongo()

const REF = 'RPT-2026-2401'
const BAY = new Types.ObjectId()
const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'T-24',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
// An admin can open the assessment but not change its observations (RV-11).
const admin = signedInAs(app, {
  ...engineer,
  _id: new Types.ObjectId(),
  role: 'knowledge_admin' as const,
})

const json = (status: number, body: object) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
const RATED = {
  category: 'Protection',
  severity: 'high',
  check: { category: false, severity: true },
  usage: [
    {
      feature: 'site_walk',
      billed_service: 'typesafe-jev',
      model: 'jev',
      duration_ms: 40,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      search_units: null,
      audio_seconds: null,
      usage_status: 'recorded',
    },
  ],
}
const DESCRIBED = {
  description: 'A hose reel blocked by pallets.',
  hazard_type: 'Housekeeping',
  provider: 'gemini',
  model: 'gemini-3.8-flash',
  prompt_version: 'cp24-v1',
  usage: null,
}
// rag-service's PrivacyUnavailable (microservices/rag-service/app/privacy.py), as a 502.
const MASKING_DOWN =
  "Client details couldn't be protected because the privacy service isn't available, so nothing was sent to the AI model."

beforeEach(async () => {
  setInlineAttempts(1)
  transcribe.mockImplementation(() => json(200, { transcript: 'The valve was shut.' }))
  describePhotos.mockImplementation(() => json(200, DESCRIBED))
  rate.mockImplementation(() => json(200, RATED))
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'))
    if (url.endsWith('/observations/rate')) return rate(body)
    if (url.endsWith('/interpret')) return describePhotos(body)
    if (url.endsWith('/transcribe')) return transcribe(body)
    return json(404, { detail: `unexpected ${url}` })
  })
  const site = await SiteModel.create({
    code: 'SITE-2401',
    name: 'Tuas Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Cold store',
  })
  const assessment = await AssessmentModel.create({
    reference: REF,
    site: site._id,
    surveyType: 'First survey',
    engineer: engineer._id,
    locations: [{ _id: BAY, name: 'Bay 1', key: 'bay 1|' }],
  })
  await CaptureSessionModel.create({ assessment: assessment._id, status: 'active' })
})
afterEach(async () => {
  await drainInlineJobs()
  s3.clear()
  vi.unstubAllGlobals()
  transcribe.mockReset()
  describePhotos.mockReset()
  rate.mockReset()
})

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')])
const AUDIO = Buffer.from('fake webm audio')

// Saves an observation as New Observation does, with only what the test names.
function save(
  details: object,
  { recordings = 0, photos = 0 }: { recordings?: number; photos?: number } = {},
) {
  const req = api
    .post(`/api/assessments/${REF}/observations`)
    .field('details', JSON.stringify({ locationId: String(BAY), ...details }))
  for (let i = 0; i < recordings; i++)
    req.attach('recording', AUDIO, { filename: `Recording ${i + 1}`, contentType: 'audio/webm' })
  for (let i = 0; i < photos; i++)
    req.attach('photo', JPG, { filename: `IMG_${i}.jpg`, contentType: 'image/jpeg' })
  return req
}
const NOTE = 'Hose reel H3 blocked by stacked pallets.'
const one = async (id: string) => (await api.get(`/api/observations/${id}`)).body
// Saves, then waits for the reading job (and anything it queued) to finish.
async function saved(details: object, media?: Parameters<typeof save>[1]) {
  const response = await save(details, media)
  expect(response.status).toBe(201)
  await drainInlineJobs()
  return one(response.body.id)
}

describe('saving with category and severity left empty (seam 1)', () => {
  it('needs only a location; without one nothing is saved', async () => {
    const refused = await save({ note: NOTE, locationId: undefined })
    expect(refused.status).toBe(400)
    expect(refused.body.fields.locationId).toBeTruthy()

    // The response comes back before the job writes anything.
    const response = await save({ note: NOTE })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      copeDimensions: null,
      severity: null,
      toCheck: true,
      suggestion: { status: 'reading', error: null, category: null, severity: null },
    })
  })

  it('fills only the empty fields, marks the not-sure one, and records the cost (AC6, AC7)', async () => {
    const done = await saved({ note: NOTE, copeDimensions: ['Exposure'] })

    expect(rate).toHaveBeenCalledWith({
      text: NOTE,
      privacy: { enabled: false, known_entities: [] },
    })
    expect(done).toMatchObject({
      copeDimensions: ['Exposure'],
      severity: 'high',
      suggestion: { status: 'done', category: null, severity: { notSure: true } },
      toCheck: true,
    })
    expect(await AiCallModel.find({ feature: 'site-walk', reportId: REF })).toHaveLength(1)
  })

  it('runs nothing when both fields are the engineer’s', async () => {
    const done = await saved({ note: NOTE, copeDimensions: ['Exposure'], severity: 'low' })
    expect(rate).not.toHaveBeenCalled()
    expect(done).toMatchObject({ suggestion: null, toCheck: false })
  })

  it('suggests nothing when there is nothing to read, leaving it to check', async () => {
    transcribe.mockImplementation(() => json(502, { detail: 'Whisper rejected the audio.' }))
    const done = await saved({}, { recordings: 1 })
    expect(rate).not.toHaveBeenCalled()
    expect(done).toMatchObject({ copeDimensions: null, severity: null, toCheck: true })
  })
})

describe('confirming and changing a suggestion (seam 1)', () => {
  it('clears the mark on confirm or change, and a second read keeps the engineer’s values (AC8-AC10)', async () => {
    rate.mockImplementation(() =>
      json(200, { ...RATED, check: { category: true, severity: true } }),
    )
    const { id } = await saved({ note: NOTE })
    expect(await one(id)).toMatchObject({
      suggestion: { category: { notSure: true }, severity: { notSure: true } },
    })

    // Change makes the category the engineer's; the severity stays a suggestion.
    const changed = await api
      .patch(`/api/observations/${id}`)
      .send({ copeDimensions: ['Exposure'] })
    expect(changed.status).toBe(200)
    expect(changed.body.suggestion).toMatchObject({ category: null, severity: { notSure: true } })

    // New media reads it again: only the severity is suggested again.
    rate.mockImplementation(() =>
      json(200, {
        category: 'Construction',
        severity: 'low',
        check: { category: false, severity: false },
      }),
    )
    await api
      .post(`/api/observations/${id}/media`)
      .attach('recording', AUDIO, { filename: 'Recording 2', contentType: 'audio/webm' })
      .expect(200)
    await drainInlineJobs()
    expect(await one(id)).toMatchObject({
      copeDimensions: ['Exposure'],
      severity: 'low',
      suggestion: { status: 'done', category: null, severity: { notSure: false } },
      toCheck: false,
    })

    // Confirm keeps the value; once both are the engineer's nothing is rated again.
    const confirmed = await api.patch(`/api/observations/${id}`).send({ confirm: ['severity'] })
    expect(confirmed.body).toMatchObject({ severity: 'low', suggestion: null, toCheck: false })
    const calls = rate.mock.calls.length
    const after = await one(id)
    await api
      .put(`/api/observations/${id}/recordings/${after.recordings[0].id}/transcript`)
      .send({ text: 'The valve was open.' })
      .expect(200)
    await drainInlineJobs()
    expect(rate).toHaveBeenCalledTimes(calls)
    expect(await one(id)).toMatchObject({ copeDimensions: ['Exposure'], severity: 'low' })
  })

  it('writes the value the engineer sent even when it matches what they saw, over a run landing meanwhile (AC9)', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'] })
    // They choose the suggested "high" they see; a newer run writes "moderate" first.
    let race = beforeNextWrite(() =>
      ObservationModel.updateOne(
        { _id: id },
        { $set: { severity: 'moderate', 'suggestion.severity': { notSure: false } } },
      ),
    )
    const chosen = await api.patch(`/api/observations/${id}`).send({ severity: 'high' })
    race.mockRestore()
    expect(chosen.body).toMatchObject({ severity: 'high', suggestion: null })

    // Emptying a severity while it is read: a value landing meanwhile is not left as theirs.
    await ObservationModel.updateOne(
      { _id: id },
      { $set: { severity: null, 'suggestion.severity': null, 'suggestion.status': 'reading' } },
    )
    race = beforeNextWrite(() =>
      ObservationModel.updateOne(
        { _id: id },
        { $set: { severity: 'high', 'suggestion.severity': { notSure: true } } },
      ),
    )
    const emptied = await api.patch(`/api/observations/${id}`).send({ severity: null })
    race.mockRestore()
    expect(emptied.body).toMatchObject({ severity: null, suggestion: { severity: null } })
  })

  it('reads again when the note changes, and not for the same note (CP-24)', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'] })
    expect(rate).toHaveBeenCalledTimes(1)
    await api.patch(`/api/observations/${id}`).send({ note: NOTE }).expect(200)
    await drainInlineJobs()
    expect(rate).toHaveBeenCalledTimes(1)

    await api
      .patch(`/api/observations/${id}`)
      .send({ note: 'Hose reel H3 blocked; sprinkler valve shut.' })
      .expect(200)
    await drainInlineJobs()
    expect(rate).toHaveBeenCalledTimes(2)
    expect(rate.mock.calls[1][0].text).toBe('Hose reel H3 blocked; sprinkler valve shut.')
  })

  it('lets only whoever may change the observation confirm or try again', async () => {
    const { id } = await saved({ note: NOTE })
    expect(
      (await admin.patch(`/api/observations/${id}`).send({ confirm: ['severity'] })).status,
    ).toBe(403)
    expect((await admin.post(`/api/observations/${id}/suggestion/retry`)).status).toBe(403)
    // The admin still sees the marks.
    expect((await admin.get(`/api/observations/${id}`)).body.suggestion.severity).toEqual({
      notSure: true,
    })
  })

  it('answers 404 for the removed Get AI proposal route (AC15)', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'], severity: 'low' })
    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(404)
  })
})

describe('the reading job (seam 2)', () => {
  it('waits while a recording is transcribing, then reads its transcript (AC2, AC6)', async () => {
    let finish!: (reply: Response) => void
    transcribe.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)))
    const response = await save({ note: NOTE }, { recordings: 1 })
    // Still transcribing: no rating yet, and it shows as being read.
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rate).not.toHaveBeenCalled()
    expect((await one(response.body.id)).suggestion.status).toBe('reading')

    finish(await json(200, { transcript: 'The valve was shut.' }))
    await vi.waitFor(async () =>
      expect((await one(response.body.id)).suggestion.status).toBe('done'),
    )
    expect(rate).toHaveBeenCalledTimes(1)
    expect(rate.mock.calls[0][0].text).toBe(`${NOTE}\n\nThe valve was shut.`)
  })

  it('describes the photos first, as the system, and reads the description (AC5)', async () => {
    const done = await saved({}, { photos: 1 })
    expect(describePhotos).toHaveBeenCalledTimes(1)
    expect(describePhotos.mock.calls[0][0]).not.toHaveProperty('parts')
    expect(rate.mock.calls[0][0].text).toBe(DESCRIBED.description)
    expect(done.interpretation.photos).toMatchObject({
      status: 'interpreted',
      description: DESCRIBED.description,
      outOfDate: false,
    })
    // A marked photo is described again, and suggested again from it.
    await api
      .put(`/api/observations/${done.id}/photos/${done.photos[0].id}/region`)
      .send({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
      .expect(200)
    await drainInlineJobs()
    expect(describePhotos).toHaveBeenCalledTimes(2)
    expect(rate).toHaveBeenCalledTimes(2)
  })

  it('rates a note tagged only Recommendation from its whole note, so it can be drafted (CP-36)', async () => {
    const done = await saved({ note: NOTE, kinds: ['recommendation'] })
    expect(rate.mock.calls[0][0].text).toBe(NOTE)
    expect(done.copeDimensions).toEqual(['Protection'])
  })

  it('never rates a note that is only a request for the client (CP-36)', async () => {
    await saved({ note: NOTE, kinds: ['info_request'] })
    expect(rate).not.toHaveBeenCalled()
  })

  it('sends no Note with the photos when the note is only a request (CP-36)', async () => {
    await saved({ note: NOTE, kinds: ['info_request'] }, { photos: 1 })
    expect(describePhotos.mock.calls[0][0].texts).toEqual([])
  })

  it('tries a failure again, then stores it as failed, and Try again reads anew (AC13)', async () => {
    setInlineAttempts(2)
    rate.mockImplementation(() => json(500, { detail: 'Classifier down.' }))
    const failed = await saved({ note: NOTE })
    expect(rate).toHaveBeenCalledTimes(2)
    expect(failed).toMatchObject({
      copeDimensions: null,
      severity: null,
      toCheck: true,
      suggestion: { status: 'failed', error: 'The category and severity could not be suggested.' },
    })
    expect((await ObservationModel.findById(failed.id).lean())?.suggestion?.attempts).toBe(2)

    rate.mockImplementation(() => json(200, RATED))
    const retried = await api.post(`/api/observations/${failed.id}/suggestion/retry`)
    expect(retried.status).toBe(202)
    expect(retried.body.suggestion.status).toBe('reading')
    await drainInlineJobs()
    expect((await one(failed.id)).suggestion.status).toBe('done')
    // Only a failed suggestion can be tried again.
    expect((await api.post(`/api/observations/${failed.id}/suggestion/retry`)).status).toBe(409)
  })

  it('stores failed at once when masking is unavailable, leaving the fields empty (AC14)', async () => {
    setInlineAttempts(2)
    rate.mockImplementation(() => json(502, { detail: MASKING_DOWN }))
    const done = await saved({ note: NOTE })
    expect(rate).toHaveBeenCalledTimes(1)
    expect(done).toMatchObject({
      copeDimensions: null,
      severity: null,
      suggestion: { status: 'failed', error: MASKING_DOWN },
    })
  })

  it('runs nothing on an archived assessment', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'], severity: 'low' })
    // As a run queued just before the assessment was archived.
    await ObservationModel.updateOne(
      { _id: id },
      { $set: { 'metadata.COPE_dimension': null, suggestion: { status: 'reading', run: 7 } } },
    )
    await AssessmentModel.updateOne({ reference: REF }, { archivedAt: new Date() })
    await runReading(id, 7)
    expect(rate).not.toHaveBeenCalled()
    expect((await ObservationModel.findById(id).lean())?.suggestion?.status).toBe('done')
  })

  it('keeps a value the engineer chose while it ran, and drops a run a newer trigger replaced', async () => {
    let answer!: (reply: Response) => void
    rate.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    const { id } = (await save({ note: NOTE })).body
    await vi.waitFor(() => expect(rate).toHaveBeenCalledTimes(1))
    await api.patch(`/api/observations/${id}`).send({ severity: 'low' }).expect(200)
    answer(await json(200, RATED))
    await drainInlineJobs()
    expect(await one(id)).toMatchObject({
      copeDimensions: ['Protection'],
      severity: 'low',
      suggestion: { status: 'done', category: { notSure: false }, severity: null },
    })

    // A photo added mid-run starts a newer run: the older answer is not saved.
    rate.mockReset()
    rate.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    rate.mockImplementation(() =>
      json(200, {
        category: 'Exposure',
        severity: 'moderate',
        check: { category: false, severity: false },
      }),
    )
    const second = (await save({ note: NOTE })).body.id
    await vi.waitFor(() => expect(rate).toHaveBeenCalledTimes(1))
    await api
      .post(`/api/observations/${second}/media`)
      .attach('photo', JPG, { filename: 'IMG_9.jpg', contentType: 'image/jpeg' })
      .expect(200)
    await vi.waitFor(() => expect(rate).toHaveBeenCalledTimes(2))
    answer(await json(200, RATED))
    await drainInlineJobs()
    expect(await one(second)).toMatchObject({ copeDimensions: ['Exposure'], severity: 'moderate' })
  })

  it('numbers photos with the same name, as S5 needs, and keeps each blurred copy with its own photo', async () => {
    describePhotos.mockImplementation((body) => {
      // As S5 (speech-ocr-service app/api/routes.py): every label its own.
      const items = [...(body.photos as Body[]), ...(body.texts as Body[])]
      const labels = items.map((item) => item.label)
      if (new Set(labels).size !== labels.length)
        return json(422, { detail: 'Each item needs its own label.' })
      const image = Buffer.from('blurred').toString('base64')
      return json(200, {
        ...DESCRIBED,
        redacted_photos: [{ label: 'image.jpg (2)', faces: 1, image }],
      })
    })
    const response = await save({ note: NOTE })
      .attach('photo', JPG, { filename: 'image.jpg', contentType: 'image/jpeg' })
      .attach('photo', JPG, { filename: 'image.jpg', contentType: 'image/jpeg' })
    expect(response.status).toBe(201)
    await drainInlineJobs()

    const labels = (describePhotos.mock.calls[0][0].photos as Body[]).map((p) => p.label)
    expect(labels).toEqual(['image.jpg', 'image.jpg (2)'])
    expect((await one(response.body.id)).interpretation.photos.status).toBe('interpreted')
    const stored = (await ObservationModel.findById(response.body.id).lean())!
    expect(stored.photos?.[0].redaction).toBeUndefined()
    expect(stored.photos?.[1].redaction).toMatchObject({ faces: 1 })
  })

  it('describes the photos again from Try again after their description failed', async () => {
    describePhotos.mockImplementationOnce(() => json(500, { detail: 'S5 is down.' }))
    const failed = await saved({}, { photos: 1 })
    expect(failed.interpretation.photos.status).toBe('failed')
    expect(rate).not.toHaveBeenCalled()

    const retried = await api.post(`/api/observations/${failed.id}/suggestion/retry`)
    expect(retried.status).toBe(202)
    await drainInlineJobs()
    expect(describePhotos).toHaveBeenCalledTimes(2)
    expect(await one(failed.id)).toMatchObject({
      interpretation: { photos: { status: 'interpreted' } },
      copeDimensions: ['Protection'],
      severity: 'high',
    })
  })

  it('reads again on restore, so one deleted before its reading ran is not left empty', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'], severity: 'low' })
    // As a run queued just before the engineer deleted it.
    await ObservationModel.updateOne(
      { _id: id },
      {
        $set: {
          'metadata.COPE_dimension': null,
          severity: null,
          suggestion: { status: 'reading', run: 7, attempts: 0, category: null, severity: null },
        },
      },
    )
    await api.delete(`/api/observations/${id}`).expect(200)
    await runReading(id, 7)
    expect(rate).not.toHaveBeenCalled()

    await api.post(`/api/observations/${id}/restore`).expect(200)
    await drainInlineJobs()
    expect(rate).toHaveBeenCalledTimes(1)
    expect(await one(id)).toMatchObject({ copeDimensions: ['Protection'], severity: 'high' })
  })
})

describe('draft observations (seam 1)', () => {
  const addDraft = (draftId?: string) => {
    const req = api
      .post(`/api/assessments/${REF}/observations/draft`)
      .attach('recording', AUDIO, { filename: 'Recording 1', contentType: 'audio/webm' })
    return draftId ? req.field('draftId', draftId) : req
  }

  it('transcribes before Save, is in no list or drafting input, and becomes the observation on Save (AC1, AC2)', async () => {
    const created = await addDraft()
    expect(created.status).toBe(201)
    const draft = created.body.draft
    expect(draft.location).toBeNull()
    expect((await addDraft(draft.id)).body.draft.recordings).toHaveLength(2)
    await drainInlineJobs()
    expect((await one(draft.id)).recordings[0].transcription.transcript).toBe('The valve was shut.')

    expect((await api.get(`/api/assessments/${REF}/observations`)).body).toEqual([])
    expect(await listObservations(REF, { includeDeleted: true })).toEqual([])
    expect(await draftingEvidence(REF)).toEqual([])
    // Only whoever may edit the assessment can read it.
    expect((await admin.get(`/api/observations/${draft.id}`)).status).toBe(403)
    expect(rate).not.toHaveBeenCalled()

    const response = await save({ draftId: draft.id, copeDimensions: ['Exposure'] })
    expect(response.status).toBe(201)
    expect(response.body.id).toBe(draft.id)
    expect(response.body.recordings).toHaveLength(2)
    await drainInlineJobs()
    const listed = (await api.get(`/api/assessments/${REF}/observations`)).body
    expect(listed.map((o: { id: string }) => o.id)).toEqual([draft.id])
    expect(listed[0]).toMatchObject({ severity: 'high', location: { name: 'Bay 1' } })
    // Saved once: a second Save of the same draft finds none.
    expect((await save({ draftId: draft.id })).status).toBe(404)
  })

  it('deletes a recording for good, and the draft with its files when discarded or stale (AC3)', async () => {
    const draft = (await addDraft()).body.draft
    await addDraft(draft.id)
    await drainInlineJobs()
    expect(s3.size).toBe(2)

    const [first, second] = (await one(draft.id)).recordings
    const removed = await api.delete(`/api/observations/${draft.id}/recordings/${first.id}`)
    expect(removed.status).toBe(200)
    expect(removed.body.recordings.map((r: { id: string }) => r.id)).toEqual([second.id])
    expect(removed.body.removedRecordings).toEqual([])
    expect(s3.size).toBe(1)

    expect((await api.delete(`/api/observations/${draft.id}/draft`)).status).toBe(204)
    expect(await ObservationModel.exists({ _id: draft.id })).toBeNull()
    expect(s3.size).toBe(0)

    // A draft is aged by its last change: one started over 24 hours ago that
    // just took a recording is kept, as its form is still open.
    const old = (await addDraft()).body.draft
    const fresh = (await addDraft()).body.draft
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const age = (fields: object) =>
      ObservationModel.collection.updateOne({ _id: new Types.ObjectId(old.id) }, { $set: fields })
    await drainInlineJobs()
    await age({ createdAt: dayAgo, updatedAt: dayAgo })
    await addDraft(old.id)
    await drainInlineJobs()
    expect(await cleanupStaleDrafts(new Date())).toBe(0)

    // Unchanged for over 24 hours, it is cleaned up; a newer one is kept.
    await age({ updatedAt: dayAgo })
    expect(await cleanupStaleDrafts(new Date())).toBe(1)
    expect(await ObservationModel.exists({ _id: old.id })).toBeNull()
    expect(await ObservationModel.exists({ _id: fresh.id })).not.toBeNull()
  })

  it('keeps the draft and its audio when a file could not be deleted, and cleanup tries again', async () => {
    const draft = (await addDraft()).body.draft
    await addDraft(draft.id)
    await drainInlineJobs()
    const [first] = (await one(draft.id)).recordings

    // One recording: refused, kept with its file, so nothing points at a missing file or is orphaned.
    deleteObject.mockRejectedValueOnce(new Error('S3 is down.'))
    const removed = await api.delete(`/api/observations/${draft.id}/recordings/${first.id}`)
    expect(removed.status).toBe(409)
    expect((await one(draft.id)).recordings).toHaveLength(2)
    expect(s3.size).toBe(2)

    // Discard: answered as done (the engineer has left), the draft kept for the cleanup.
    deleteObject.mockRejectedValueOnce(new Error('S3 is down.'))
    expect((await api.delete(`/api/observations/${draft.id}/draft`)).status).toBe(204)
    expect(await ObservationModel.exists({ _id: draft.id })).not.toBeNull()
    expect(s3.size).toBe(1)

    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(draft.id) },
      { $set: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } },
    )
    deleteObject.mockRejectedValueOnce(new Error('S3 is down.'))
    expect(await cleanupStaleDrafts(new Date())).toBe(0)
    expect(await ObservationModel.exists({ _id: draft.id })).not.toBeNull()
    expect(await cleanupStaleDrafts(new Date())).toBe(1)
    expect(await ObservationModel.exists({ _id: draft.id })).toBeNull()
    expect(s3.size).toBe(0)
  })

  it('refuses a Save that brings nothing once the draft’s only recording was removed meanwhile', async () => {
    const draft = (await addDraft()).body.draft
    await drainInlineJobs()
    const race = beforeNextWrite(() =>
      ObservationModel.updateOne({ _id: draft.id }, { $set: { recordings: [] } }),
    )
    const response = await save({ draftId: draft.id })
    race.mockRestore()
    expect(response.status).toBe(400)
    expect(response.body.error).toBe(
      'Add a note, a recording, a photo or a page to the observation.',
    )
    expect(await ObservationModel.exists({ _id: draft.id, draft: true })).not.toBeNull()
  })

  it('refuses to discard a saved observation', async () => {
    const { id } = await saved({ note: NOTE, copeDimensions: ['Exposure'], severity: 'low' })
    expect((await api.delete(`/api/observations/${id}/draft`)).status).toBe(404)
  })
})

describe('drafting leaves out anything to check (seam 1, AC12)', () => {
  it('uses an observation once its not-sure value is confirmed, and the evidence changes', async () => {
    const { id } = await saved({ note: NOTE })
    const before = evidenceFingerprint(await listObservations(REF))
    expect(await draftingEvidence(REF)).toEqual([])

    await api
      .patch(`/api/observations/${id}`)
      .send({ confirm: ['severity'] })
      .expect(200)

    expect((await draftingEvidence(REF)).map((e) => e.id)).toEqual([id])
    expect(evidenceFingerprint(await listObservations(REF))).not.toBe(before)
  })
})

describe('site walk observations (CP-24 AC17)', () => {
  it('carries the proposal’s not-sure flags onto the created observation, unread', async () => {
    const assessment = (await AssessmentModel.findOne({ reference: REF }))!
    const session = (await CaptureSessionModel.findOne({ assessment: assessment._id }))!
    const id = new Types.ObjectId()
    await createWalkObservation({
      reference: REF,
      id,
      assessmentId: assessment._id,
      sessionId: session._id,
      site: null,
      user: { id: String(engineer._id), role: engineer.role, name: engineer.name },
      locationId: BAY,
      note: NOTE,
      severity: 'high',
      copeDimensions: ['Protection'],
      evidence: { clip: null, photos: [] },
      siteWalk: new Types.ObjectId(),
      check: { category: false, severity: true },
    })
    expect(await one(String(id))).toMatchObject({
      suggestion: { status: 'done', category: null, severity: { notSure: true } },
      toCheck: true,
    })
    expect(rate).not.toHaveBeenCalled()
  })

  it('describes its photos without rating it, even after a page transcribes, until the engineer changes it', async () => {
    const assessment = (await AssessmentModel.findOne({ reference: REF }))!
    const session = (await CaptureSessionModel.findOne({ assessment: assessment._id }))!
    const id = new Types.ObjectId()
    s3.set('walks/photo-1.jpg', JPG)
    const image = { contentType: 'image/jpeg' as const, size: JPG.length }
    await createWalkObservation({
      reference: REF,
      id,
      assessmentId: assessment._id,
      sessionId: session._id,
      site: null,
      user: { id: String(engineer._id), role: engineer.role, name: engineer.name },
      locationId: BAY,
      note: NOTE,
      severity: 'high',
      copeDimensions: ['Protection'],
      evidence: {
        clip: null,
        photos: [{ photoId: 'p1', key: 'walks/photo-1.jpg', ...image }],
        pages: [{ key: 'walks/page-1.jpg', ...image }],
      },
      siteWalk: new Types.ObjectId(),
      check: { category: false, severity: true },
    })
    // The page finishing (here, failing) queues the reading again.
    await vi.waitFor(async () =>
      expect((await one(String(id))).pages[0].transcription.status).not.toBe('transcribing'),
    )
    await drainInlineJobs()
    expect(describePhotos).toHaveBeenCalledTimes(1)
    expect(rate).not.toHaveBeenCalled()
    expect(await one(String(id))).toMatchObject({
      severity: 'high',
      suggestion: { status: 'done', category: null, severity: { notSure: true } },
      interpretation: { photos: { status: 'interpreted' } },
    })

    // Once the engineer edits it, it is read like any other observation.
    await api
      .patch(`/api/observations/${id}`)
      .send({ note: 'Hose reel H3 blocked by pallets.' })
      .expect(200)
    await drainInlineJobs()
    expect(rate).toHaveBeenCalledTimes(1)
  })
})

describe('the push to the open page (seam 4)', () => {
  let server: http.Server
  let port: number
  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  it('tells an open stream when a reading finishes, without polling (AC6)', async () => {
    const frames: string[] = []
    const res = await new Promise<http.IncomingMessage>((resolve, reject) =>
      http
        .get(
          {
            host: '127.0.0.1',
            port,
            path: `/api/assessments/${REF}/assistant/events`,
            headers: { Cookie: `session=${signSession(engineer)}` },
          },
          resolve,
        )
        .on('error', reject),
    )
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => frames.push(chunk))

    await saved({ note: NOTE })

    await vi.waitFor(() => expect(frames.join('')).toMatch(/event: observations\ndata: \{.*\}\n\n/))
    res.destroy()
  })
})
