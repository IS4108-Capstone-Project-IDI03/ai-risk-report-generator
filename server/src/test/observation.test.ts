import { Types } from 'mongoose'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import type { ReadingPrivacy } from '../services/privacy.service'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { transcriptionQueue } from '../services/background-queues.service'
import {
  failInterruptedInterpretations,
  resumeInterruptedTranscriptions,
  runTranscription,
  listCategoryObservations,
  createWalkObservation,
} from '../services/observation.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

// S3 stands in as a map; S5 as a stubbed fetch.
const s3 = vi.hoisted(() => new Map<string, Buffer>())
// A write to a key it matches fails, as S3 would when unreachable.
const failingWrites = vi.hoisted(() => ({ match: null as RegExp | null }))
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => {
    if (failingWrites.match?.test(key)) throw new Error('S3 unreachable')
    s3.set(key, body)
  },
  getObjectStream: async (key: string, range?: { start: number; end: number }) =>
    Readable.from([range ? s3.get(key)!.subarray(range.start, range.end + 1) : s3.get(key)]),
  deleteObject: async (key: string) => void s3.delete(key),
}))
const speech = vi.fn<(body: { s3_key: string }) => Promise<Response>>()
// S5's photo interpretation (CP-05), stubbed apart from transcription.
type InterpretBody = {
  s3_keys: string[]
  location: string | null
  note: string | null
  privacy: ReadingPrivacy
}
const vision = vi.fn<(body: InterpretBody) => Promise<Response>>()
// S5's handwritten pages (CP-19), stubbed apart from voice transcription.
const handwriting = vi.fn<(body: { s3_key: string }) => Promise<Response>>()

useMemoryMongo()

// A risk engineer is allowed everything below (F-05); role limits are in permissions.test.ts.
const actor = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, actor)

beforeEach(() => {
  // Unless a test says otherwise, an interpretation never finishes, so asking
  // for photos to be read leaves nothing running in the background.
  vision.mockReturnValue(new Promise<Response>(() => {}))
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/interpret')) return vision(body)
    if (url.endsWith('/transcribe-handwriting')) return handwriting(body)
    return speech(body)
  })
})
afterEach(() => {
  s3.clear()
  failingWrites.match = null
  speech.mockReset()
  vision.mockReset()
  handwriting.mockReset()
  vi.unstubAllGlobals()
})

const AUDIO = Buffer.from('fake webm audio')
const s5 = (status: number, body: object) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const BAY_3 = new Types.ObjectId()
const PUMP_HOUSE = new Types.ObjectId()

async function assessmentWithSession(
  reference = 'RPT-2026-0411',
  status: CaptureSessionStatus = 'active',
) {
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const assessment = await AssessmentModel.create({
    reference,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    // Only the assigned engineer can change its observations (CP-08).
    engineer: actor._id,
    locations: [
      {
        _id: BAY_3,
        name: 'Bay 3 — north aisle',
        floor: 'Ground',
        key: 'bay 3 — north aisle|ground',
      },
      { _id: PUMP_HOUSE, name: 'Pump house', key: 'pump house|' },
    ],
  })
  await CaptureSessionModel.create({ assessment: assessment._id, status })
  return assessment
}

type Recording = { audio?: Buffer; type?: string; name?: string }

// Saves an observation as the capture screen does: a JSON `details` part and a
// `recording` part per audio file.
function save(fields: object = {}, recordings: Recording[] = [{}], reference = 'RPT-2026-0411') {
  const req = api.post(`/api/assessments/${reference}/observations`).field(
    'details',
    JSON.stringify({
      engineer: 'Alex Rowe',
      copeDimensions: ['Protection'],
      severity: 'high',
      locationId: String(BAY_3),
      ...fields,
    }),
  )
  recordings.forEach((r, i) =>
    req.attach('recording', r.audio ?? AUDIO, {
      filename: r.name ?? `Recording ${i + 1}`,
      contentType: r.type ?? 'audio/webm',
    }),
  )
  return req
}
const note = (fields: object = {}) =>
  save({ note: 'Hose reel H3 blocked by stacked pallets.', ...fields }, [])

// Transcription runs after the response, so wait for every recording to settle.
async function settled(id: string) {
  await vi.waitFor(async () => {
    const o = await ObservationModel.findById(id).lean()
    expect(o?.recordings.map((r) => r.transcription.status)).not.toContain('transcribing')
  })
  return (await ObservationModel.findById(id).lean())!
}

describe('creating a reviewed site walk observation', () => {
  async function walkObservationInput() {
    const assessment = await assessmentWithSession()
    const session = await CaptureSessionModel.findOne({ assessment: assessment._id })
    return {
      reference: assessment.reference,
      id: new Types.ObjectId(),
      assessmentId: assessment._id,
      sessionId: session!._id,
      site: null,
      user: { id: String(actor._id), role: actor.role, name: actor.name },
      locationId: BAY_3,
      note: 'Pallets block the hose reel.',
      severity: 'high' as const,
      copeDimensions: ['Protection' as const],
      evidence: {
        clip: null,
        photos: [
          { photoId: 'p1', key: 'walk/photo.jpg', contentType: 'image/jpeg' as const, size: 5 },
        ],
      },
      siteWalk: new Types.ObjectId(),
    }
  }

  it('accepts concurrent creates of the same finding and keeps only its saved photos', async () => {
    const input = await walkObservationInput()
    s3.set('walk/photo.jpg', Buffer.from('photo'))
    // Both requests saw no observation before either could insert it.
    const exists = vi
      .spyOn(ObservationModel, 'exists')
      .mockImplementationOnce(() => Promise.resolve(null) as never)
      .mockImplementationOnce(() => Promise.resolve(null) as never)
    try {
      await expect(
        Promise.all([createWalkObservation(input), createWalkObservation(input)]),
      ).resolves.toEqual([undefined, undefined])
    } finally {
      exists.mockRestore()
    }

    expect(await ObservationModel.countDocuments()).toBe(1)
    const saved = await ObservationModel.findById(input.id).lean()
    expect(saved?.photos).toHaveLength(1)
    const photoKey = saved!.photos![0].key
    expect([...s3.keys()].sort()).toEqual(['walk/photo.jpg', photoKey].sort())
    expect(s3.get(photoKey)).toEqual(Buffer.from('photo'))
  })

  it.each(['assessmentId', 'siteWalk'] as const)(
    'refuses an existing id belonging to another %s',
    async (field) => {
      const input = await walkObservationInput()
      s3.set('walk/photo.jpg', Buffer.from('photo'))
      await createWalkObservation(input)
      const other = { ...input, [field]: new Types.ObjectId() }

      await expect(createWalkObservation(other)).rejects.toMatchObject({ code: 11000 })
      expect(await ObservationModel.countDocuments()).toBe(1)
    },
  )

  it('still reports an unrelated database failure and removes its uploaded photos', async () => {
    const input = await walkObservationInput()
    s3.set('walk/photo.jpg', Buffer.from('photo'))
    const failure = new Error('Mongo is down.')
    const create = vi.spyOn(ObservationModel, 'create').mockRejectedValueOnce(failure)
    try {
      await expect(createWalkObservation(input)).rejects.toBe(failure)
    } finally {
      create.mockRestore()
    }
    expect([...s3.keys()]).toEqual(['walk/photo.jpg'])
  })
})

describe('POST /api/assessments/:reference/observations', () => {
  it('saves a note and recordings as one observation, with each recording in S3', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Sprinkler valve chained open.' }))
    const assessment = await assessmentWithSession()
    const text = '  Valve V-12 chained open.\nTag missing — recheck at close.  '

    const response = await save({ note: text, locationId: String(PUMP_HOUSE) }, [
      {},
      { name: 'valve.m4a', type: 'audio/x-m4a' },
    ])

    expect(response.status).toBe(201)
    const stored = await ObservationModel.findById(response.body.id).lean()
    // The note is kept exactly as written.
    expect(stored?.note).toBe(text)
    expect(stored?.engineer).toBe('Alex Rowe')
    expect(String(stored?.engineerId)).toBe(String(actor._id))
    expect(response.body.engineerId).toBe(String(actor._id))
    expect(response.body.recordings.map((r: { type: string }) => r.type)).toEqual([
      'Voice',
      'Voice',
    ])
    expect(stored?.severity).toBe('high')
    expect(String(stored?.location)).toBe(String(PUMP_HOUSE))
    expect(response.body.location).toEqual({
      id: String(PUMP_HOUSE),
      building: null,
      name: 'Pump house',
      floor: null,
    })
    expect(stored?.recordings.map((r) => r.name)).toEqual(['Recording 1', 'valve.m4a'])
    const [first, second] = stored!.recordings
    expect(first.key).toBe(`audio/RPT-2026-0411/${response.body.id}/${first._id}.webm`)
    expect(second.key).toMatch(/\.m4a$/)
    expect(s3.get(first.key)).toEqual(AUDIO)
    expect(stored?.metadata).toMatchObject({
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Protection'],
    })
    expect(new Date(response.body.recordedAt)).toEqual(stored!.createdAt)
    // Saved by hand, so not marked as from a site walk (CP-22 round 3).
    expect(response.body.fromSiteWalk).toBe(false)
    // Saving adds to the session without ending it.
    const session = await CaptureSessionModel.findOne({ assessment: assessment._id }).lean()
    expect(String(stored?.session)).toBe(String(session?._id))
    expect(session?.status).toBe('active')
    await settled(response.body.id)
  })

  it('queues exactly one transcription per recording and stores each transcript', async () => {
    speech.mockImplementation(({ s3_key }) =>
      s5(200, { transcript: s3_key.endsWith('.wav') ? 'Second.' : 'First.' }),
    )
    await assessmentWithSession()

    const response = await save({}, [{}, { type: 'audio/wav' }])

    expect(response.body.recordings.map((r: { transcription: object }) => r.transcription)).toEqual(
      [1, 2].map(() => expect.objectContaining({ status: 'transcribing', attempts: 1 })),
    )
    const done = await settled(response.body.id)
    expect(done.recordings.map((r) => r.transcription.transcript)).toEqual(['First.', 'Second.'])
    expect(done.recordings.map((r) => r.transcription.attempts.length)).toEqual([1, 1])
    expect(speech).toHaveBeenCalledTimes(2)
  })

  it('records the reason when a transcription fails, leaving the others', async () => {
    speech.mockImplementation(({ s3_key }) =>
      s3_key.endsWith('.wav')
        ? s5(502, { detail: 'Whisper rejected the audio: file is too short.' })
        : s5(200, { transcript: 'Fine.' }),
    )
    await assessmentWithSession()

    const done = await settled((await save({}, [{}, { type: 'audio/wav' }])).body.id)

    const [ok, failed] = done.recordings
    expect(ok.transcription.status).toBe('transcribed')
    expect(failed.transcription.status).toBe('failed')
    expect(failed.transcription.error).toBe('Whisper rejected the audio: file is too short.')
    expect(failed.transcription.attempts[0].finishedAt).toBeInstanceOf(Date)
  })

  it('says so when the speech service cannot be reached', async () => {
    speech.mockRejectedValue(new TypeError('fetch failed'))
    await assessmentWithSession()

    const done = await settled((await save()).body.id)

    expect(done.recordings[0].transcription.error).toBe('The speech service could not be reached.')
  })

  it('saves a note on its own, with no recordings or transcription', async () => {
    await assessmentWithSession()

    const response = await note({ standard: 'NFPA 25 – 2026 Edition' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      note: 'Hose reel H3 blocked by stacked pallets.',
      recordings: [],
      standard: 'NFPA 25 – 2026 Edition',
      location: { name: 'Bay 3 — north aisle', floor: 'Ground' },
    })
    expect(speech).not.toHaveBeenCalled()
  })

  it('keeps an uncategorised observation out of category-scoped drafting inputs', async () => {
    await assessmentWithSession()
    const uncategorised = (await note({ copeDimensions: null })).body
    const exposure = (await note({ copeDimensions: ['Exposure'] })).body

    // The field is present but null, so it is never mistaken for a category.
    const stored = await ObservationModel.findById(uncategorised.id).lean()
    expect(stored?.metadata).toHaveProperty('COPE_dimension', null)
    expect(uncategorised.copeDimensions).toBeNull()
    for (const dimension of ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const) {
      const inputs = await listCategoryObservations('RPT-2026-0411', dimension)
      expect(inputs.map((o) => o.id)).not.toContain(uncategorised.id)
    }
    const exposureInputs = await listCategoryObservations('RPT-2026-0411', 'Exposure')
    expect(exposureInputs.map((o) => o.id)).toEqual([exposure.id])
  })

  it('files one observation under several categories, in C-O-P-E order', async () => {
    await assessmentWithSession()
    const both = (await note({ copeDimensions: ['Protection', 'Construction', 'Protection'] })).body
    const none = (await note({ copeDimensions: [] })).body

    // Repeats dropped and put in C-O-P-E order, whatever order they were picked in.
    expect(both.copeDimensions).toEqual(['Construction', 'Protection'])
    const stored = await ObservationModel.findById(both.id).lean()
    expect(stored?.metadata.COPE_dimension).toEqual(['Construction', 'Protection'])
    for (const dimension of ['Construction', 'Protection'] as const) {
      const inputs = await listCategoryObservations('RPT-2026-0411', dimension)
      expect(inputs.map((o) => o.id)).toEqual([both.id])
    }
    expect(await listCategoryObservations('RPT-2026-0411', 'Exposure')).toEqual([])
    // An empty list is uncategorised, stored as null like one sent as null.
    expect(none.copeDimensions).toBeNull()
    const storedNone = await ObservationModel.findById(none.id).lean()
    expect(storedNone?.metadata).toHaveProperty('COPE_dimension', null)
  })

  it('reads a category saved as one string, before several were allowed, as a list of one', async () => {
    await assessmentWithSession()
    const { id } = (await note()).body
    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { 'metadata.COPE_dimension': 'Exposure' } },
    )

    const [listed] = (await api.get('/api/assessments/RPT-2026-0411/observations')).body
    expect(listed.copeDimensions).toEqual(['Exposure'])
    const inputs = await listCategoryObservations('RPT-2026-0411', 'Exposure')
    expect(inputs.map((o) => o.id)).toEqual([id])
    // Saving the same category again changes nothing.
    await api.patch(`/api/observations/${id}`).send({ copeDimensions: ['Exposure'] })
    expect((await ObservationModel.findById(id).lean())?.edited).toBeUndefined()
  })

  it('rejects an observation when no capture session is in progress', async () => {
    await assessmentWithSession('RPT-2026-0411', 'ready_for_generation')

    const response = await save({ note: 'x' })

    expect(response.status).toBe(409)
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('takes a new observation only from the assigned engineer, and not once archived', async () => {
    const assessment = await assessmentWithSession()
    const other = signedInAsRole(app, 'risk_engineer')
      .post('/api/assessments/RPT-2026-0411/observations')
      .field(
        'details',
        JSON.stringify({ note: 'x', copeDimensions: null, severity: 'low', locationId: BAY_3 }),
      )
    expect((await other).status).toBe(403)

    // The session opened before archiving stays active, but takes nothing.
    await AssessmentModel.updateOne({ _id: assessment._id }, { archivedAt: new Date() })
    expect((await note()).status).toBe(409)
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('rejects unknown assessments, bad recordings and an empty observation', async () => {
    await assessmentWithSession()

    expect((await save({}, [{}], 'RPT-2026-9999')).status).toBe(404)
    expect((await save({}, [{ type: 'audio/aac' }])).status).toBe(415)
    expect((await save({}, [{ audio: Buffer.from('') }])).status).toBe(400)
    expect((await save({ note: '  \n ' }, [])).status).toBe(400)
    expect((await api.post('/api/assessments/RPT-2026-0411/observations')).status).toBe(400)
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('names each invalid field', async () => {
    await assessmentWithSession()

    const invalid = [
      [{ note: 'x'.repeat(5001) }, 'note'],
      [{ copeDimensions: ['Fire protection'] }, 'copeDimensions'],
      [{ copeDimensions: undefined }, 'copeDimensions'],
      [{ copeDimensions: 'Protection' }, 'copeDimensions'],
      [{ copeDimensions: ['Protection', 'Fire protection'] }, 'copeDimensions'],
      [{ severity: 'urgent' }, 'severity'],
      [{ locationId: undefined }, 'locationId'],
      [{ locationId: 'Bay 3' }, 'locationId'],
      [{ locationId: String(new Types.ObjectId()) }, 'locationId'],
    ] as const
    for (const [fields, field] of invalid) {
      const response = await note(fields)
      expect(response.status).toBe(400)
      expect(Object.keys(response.body.fields)).toEqual([field])
    }
    expect(await ObservationModel.countDocuments()).toBe(0)
  })
})

describe('POST /api/observations/:id/recordings/:recordingId/transcription/retry', () => {
  const retry = (id: unknown, recordingId: unknown) =>
    api.post(`/api/observations/${id}/recordings/${recordingId}/transcription/retry`)

  it('starts a new attempt for the same recording', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await save()).body.id)
    const recording = failed.recordings[0]
    speech.mockReturnValueOnce(s5(200, { transcript: 'Second time lucky.' }))

    const response = await retry(failed._id, recording._id)

    expect(response.status).toBe(202)
    const done = (await settled(String(failed._id))).recordings[0]
    expect(done.transcription.status).toBe('transcribed')
    expect(done.transcription.transcript).toBe('Second time lucky.')
    expect(done.transcription.error).toBeUndefined()
    expect(done.transcription.attempts).toHaveLength(2)
    expect(done.transcription.attempts[1].finishedAt).toBeInstanceOf(Date)
    expect(speech).toHaveBeenLastCalledWith({ s3_key: recording.key })
  })

  it('fails a recording whose job cannot be queued, so Retry works', async () => {
    await assessmentWithSession()
    const down = vi.spyOn(transcriptionQueue, 'add').mockRejectedValue(new Error('redis down'))
    const { id } = (await save()).body
    await vi.waitFor(async () => {
      const o = await ObservationModel.findById(id).lean()
      expect(o?.recordings[0].transcription.status).toBe('failed')
    })
    down.mockRestore()

    const failed = (await ObservationModel.findById(id).lean())!.recordings[0]
    expect(failed.transcription.error).toContain('could not be queued')
    speech.mockReturnValueOnce(s5(200, { transcript: 'Back up.' }))
    expect((await retry(id, failed._id)).status).toBe(202)
    expect((await settled(id)).recordings[0].transcription.status).toBe('transcribed')
  })

  it('queues a retry under a new job id, so BullMQ cannot drop it as the failed job', async () => {
    const add = vi.spyOn(transcriptionQueue, 'add')
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await save()).body.id)
    speech.mockReturnValue(s5(200, { transcript: 'Done.' }))

    await retry(failed._id, failed.recordings[0]._id)
    await settled(String(failed._id))

    const [first, again] = add.mock.calls.map(([jobId]) => jobId)
    add.mockRestore()
    expect(first).toBe(`vn-${failed._id}-${failed.recordings[0]._id}`)
    expect(again).toMatch(new RegExp(`^${first}-retry-`))
  })

  it('throws when the observation cannot be read, so the queue retries the job', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Done.' }))
    await assessmentWithSession()
    const saved = await settled((await save()).body.id)
    const down = vi
      .spyOn(ObservationModel, 'findOne')
      .mockImplementationOnce(
        () => ({ lean: () => Promise.reject(new Error('Mongo is down.')) }) as never,
      )

    await expect(
      runTranscription(String(saved._id), String(saved.recordings[0]._id)),
    ).rejects.toThrow('Mongo is down.')
    down.mockRestore()
  })

  it('throws when the outcome cannot be saved, so the queue retries the job', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await save()).body.id)
    await ObservationModel.updateOne(
      { _id: failed._id },
      { 'recordings.0.transcription.status': 'transcribing' },
    )
    speech.mockReturnValue(s5(200, { transcript: 'Done.' }))
    const down = vi
      .spyOn(ObservationModel, 'updateOne')
      .mockRejectedValueOnce(new Error('Mongo is down.'))

    await expect(
      runTranscription(String(failed._id), String(failed.recordings[0]._id)),
    ).rejects.toThrow('Mongo is down.')
    down.mockRestore()
  })

  it('starts only one attempt when retry is sent twice at once', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await save()).body.id)
    speech.mockReturnValue(s5(200, { transcript: 'Done.' }))

    const statuses = (
      await Promise.all([1, 2].map(() => retry(failed._id, failed.recordings[0]._id)))
    ).map((r) => r.status)

    expect(statuses.sort()).toEqual([202, 409])
    const done = await settled(String(failed._id))
    expect(done.recordings[0].transcription.attempts).toHaveLength(2)
  })

  it('returns 404 for an unknown observation or recording', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'x' }))
    await assessmentWithSession()
    const { id } = (await save()).body
    await settled(id)

    expect((await retry('nope', 'nope')).status).toBe(404)
    expect((await retry(id, '6ab539fb4193b19ea6916320')).status).toBe(404)
  })
})

describe('PATCH /api/observations/:id', () => {
  const retag = (id: unknown, tags: object) => api.patch(`/api/observations/${id}`).send(tags)

  it('categorises an uncategorised observation, bringing it into drafting', async () => {
    await assessmentWithSession()
    const { id } = (await note({ copeDimensions: null })).body

    const response = await retag(id, { copeDimensions: ['Exposure'] })

    expect(response.status).toBe(200)
    expect(response.body.copeDimensions).toEqual(['Exposure'])
    const inputs = await listCategoryObservations('RPT-2026-0411', 'Exposure')
    expect(inputs.map((o) => o.id)).toEqual([id])
  })

  it('changes an observation’s categories, and records nothing for the same ones reordered', async () => {
    await assessmentWithSession()
    const { id } = (await note()).body

    const added = await retag(id, { copeDimensions: ['Protection', 'Construction'] })
    expect(added.body.copeDimensions).toEqual(['Construction', 'Protection'])
    const edited = (await ObservationModel.findById(id).lean())?.edited

    const reordered = await retag(id, { copeDimensions: ['Protection', 'Construction'] })
    expect(reordered.status).toBe(200)
    expect((await ObservationModel.findById(id).lean())?.edited).toEqual(edited)
    // Clearing every category uncategorises it.
    expect((await retag(id, { copeDimensions: [] })).body.copeDimensions).toBeNull()
  })

  it('keeps the new tags when the observation is reopened, leaving everything else', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Racking is new.' }))
    await assessmentWithSession()
    const saved = (await save({ note: 'Racking under heads.', standard: 'NFPA 13 – 2022 Edition' }))
      .body
    await settled(saved.id)

    const response = await retag(saved.id, {
      severity: 'critical',
      locationId: String(PUMP_HOUSE),
      standard: 'FM 2.0 – Last published April 2026',
    })

    expect(response.status).toBe(200)
    const [reopened] = (await api.get('/api/assessments/RPT-2026-0411/observations')).body
    expect(reopened).toMatchObject({
      id: saved.id,
      severity: 'critical',
      location: { id: String(PUMP_HOUSE), building: null, name: 'Pump house', floor: null },
      standard: 'FM 2.0 – Last published April 2026',
      // Left out of the request, so unchanged.
      copeDimensions: ['Protection'],
      note: 'Racking under heads.',
      engineer: 'Alex Rowe',
      recordedAt: saved.recordedAt,
    })
    expect(reopened.recordings).toEqual([
      expect.objectContaining({
        id: saved.recordings[0].id,
        transcription: expect.objectContaining({ transcript: 'Racking is new.' }),
      }),
    ])
  })

  it('uncategorises an observation and removes its standard', async () => {
    await assessmentWithSession()
    const { id } = (await note({ standard: 'NFPA 25 – 2026 Edition' })).body

    const response = await retag(id, { copeDimensions: null, standard: '' })

    expect(response.body).toMatchObject({ copeDimensions: null, standard: null })
    const stored = await ObservationModel.findById(id).lean()
    // Present but null, as when it is saved uncategorised.
    expect(stored?.metadata).toHaveProperty('COPE_dimension', null)
    expect(stored).not.toHaveProperty('standard')
    // Removing only the standard works too.
    const other = (await note({ standard: 'NFPA 25 – 2026 Edition' })).body
    expect((await retag(other.id, { standard: null })).body.standard).toBeNull()
  })

  it('accepts only the shared vocabulary and the assessment’s locations', async () => {
    await assessmentWithSession()
    const { id } = (await note()).body

    const invalid = [
      [{ copeDimensions: ['Fire protection'] }, 'copeDimensions'],
      [{ copeDimensions: ['protection'] }, 'copeDimensions'],
      [{ severity: 'urgent' }, 'severity'],
      [{ severity: null }, 'severity'],
      [{ locationId: 'Bay 3' }, 'locationId'],
      [{ locationId: String(new Types.ObjectId()) }, 'locationId'],
      [{ standard: 'x'.repeat(101) }, 'standard'],
    ] as const
    for (const [tags, field] of invalid) {
      const response = await retag(id, tags)
      expect(response.status).toBe(400)
      expect(Object.keys(response.body.fields)).toEqual([field])
    }
    // Nothing to change is refused rather than silently accepted.
    expect((await retag(id, {})).status).toBe(400)
    expect((await retag(id, { recordings: [] })).status).toBe(400)
    const stored = await ObservationModel.findById(id).lean()
    expect(stored).toMatchObject({
      severity: 'high',
      note: 'Hose reel H3 blocked by stacked pallets.',
    })
    expect(stored?.metadata.COPE_dimension).toEqual(['Protection'])
    expect(String(stored?.location)).toBe(String(BAY_3))
  })

  it('returns 404 for an unknown observation', async () => {
    expect((await retag('nope', { severity: 'low' })).status).toBe(404)
    expect((await retag(new Types.ObjectId(), { severity: 'low' })).status).toBe(404)
  })
})

const by = { id: String(actor._id), name: 'Alex Rowe' }
const edit = (id: unknown, changes: object) => api.patch(`/api/observations/${id}`).send(changes)
const correct = (id: unknown, recordingId: unknown, text: unknown) =>
  api.put(`/api/observations/${id}/recordings/${recordingId}/transcript`).send({ text })
const remove = (id: unknown) => api.delete(`/api/observations/${id}`)
const restore = (id: unknown) => api.post(`/api/observations/${id}/restore`)
const listed = async (query = '') =>
  (await api.get(`/api/assessments/RPT-2026-0411/observations${query}`)).body.map(
    (o: { id: string }) => o.id,
  )

describe('correcting an observation (CP-08)', () => {
  it('stores an edited note exactly as typed, with who edited it and when (AC8, AC11)', async () => {
    await assessmentWithSession()
    const { id } = (await note()).body
    const text = '  Hose reel H3 cleared after the visit.\nRecheck at close.  '

    const response = await edit(id, { note: text })

    expect(response.status).toBe(200)
    expect(response.body.note).toBe(text)
    expect(response.body.edited).toEqual({ at: expect.any(String), by })
    const stored = await ObservationModel.findById(id).lean()
    expect(stored?.note).toBe(text)
    expect(stored?.edited?.by).toEqual(by)
    // Saving the same note again changes nothing, so it records nothing.
    const again = await edit(id, { note: text })
    expect(again.body.edited.at).toBe(response.body.edited.at)
  })

  it('removes a note only when the observation has a recording (AC9)', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const noteOnly = (await note()).body
    const both = (await save({ note: 'Valve V-12.' })).body
    await settled(both.id)

    const refused = await edit(noteOnly.id, { note: '  ' })
    expect(refused.status).toBe(400)
    expect(Object.keys(refused.body.fields)).toEqual(['note'])
    expect((await ObservationModel.findById(noteOnly.id).lean())?.note).toBe(
      'Hose reel H3 blocked by stacked pallets.',
    )

    const removed = await edit(both.id, { note: null })
    expect(removed.status).toBe(200)
    expect(removed.body.note).toBeNull()
    expect(await ObservationModel.findById(both.id).lean()).not.toHaveProperty('note')
  })

  it('corrects a finished transcript, keeping what Whisper wrote (AC10, AC11)', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'FM 200 cylinders in the store next door.' }))
    await assessmentWithSession()
    const saved = (await save()).body
    await settled(saved.id)
    const recordingId = saved.recordings[0].id

    const response = await correct(
      saved.id,
      recordingId,
      'FM-200 cylinders in the store next door.',
    )

    expect(response.status).toBe(200)
    expect(response.body.recordings[0].transcription).toMatchObject({
      transcript: 'FM 200 cylinders in the store next door.',
      correction: { text: 'FM-200 cylinders in the store next door.', at: expect.any(String), by },
    })
    expect(response.body.edited.by).toEqual(by)
    const stored = (await ObservationModel.findById(saved.id).lean())!.recordings[0]
    expect(stored.transcription.transcript).toBe('FM 200 cylinders in the store next door.')

    // Writing Whisper's words back removes the correction.
    const reverted = await correct(
      saved.id,
      recordingId,
      'FM 200 cylinders in the store next door.',
    )
    expect(reverted.body.recordings[0].transcription.correction).toBeNull()
  })

  it('corrects only a transcript that has finished (AC10)', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = (await save()).body
    await settled(failed.id)
    speech.mockReturnValue(new Promise<Response>(() => {}))
    const transcribing = (await save()).body

    expect((await correct(failed.id, failed.recordings[0].id, 'Text.')).status).toBe(409)
    expect((await correct(transcribing.id, transcribing.recordings[0].id, 'Text.')).status).toBe(
      409,
    )
    const blank = await correct(failed.id, failed.recordings[0].id, '   ')
    expect(blank.status).toBe(400)
    expect(Object.keys(blank.body.fields)).toEqual(['text'])
    expect((await correct(failed.id, new Types.ObjectId(), 'Text.')).status).toBe(404)
  })
})

describe('deleting and restoring an observation (CP-08)', () => {
  it('marks it deleted without removing anything (AC11, AC12)', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const saved = (await save({ note: 'Valve V-12.' })).body
    await settled(saved.id)

    const response = await remove(saved.id)

    expect(response.status).toBe(200)
    expect(response.body.deleted).toEqual({ at: expect.any(String), by })
    const stored = await ObservationModel.findById(saved.id).lean()
    expect(stored).toMatchObject({ note: 'Valve V-12.', deleted: { by } })
    // The raw evidence stays in storage.
    expect(s3.get(stored!.recordings[0].key)).toEqual(AUDIO)
    // Deleting twice is refused.
    expect((await remove(saved.id)).status).toBe(409)
  })

  it('leaves a deleted observation out of the list and drafting, unless asked (AC13)', async () => {
    await assessmentWithSession()
    const kept = (await note({ copeDimensions: ['Exposure'] })).body
    const deleted = (await note({ copeDimensions: ['Exposure'] })).body

    await remove(deleted.id)

    expect(await listed()).toEqual([kept.id])
    expect((await listed('?include=deleted')).sort()).toEqual([deleted.id, kept.id].sort())
    const inputs = await listCategoryObservations('RPT-2026-0411', 'Exposure')
    expect(inputs.map((o) => o.id)).toEqual([kept.id])
  })

  it('restores a deleted observation to the list and drafting (AC14)', async () => {
    await assessmentWithSession()
    const { id } = (await note({ copeDimensions: ['Exposure'] })).body
    await remove(id)

    const response = await restore(id)

    expect(response.status).toBe(200)
    expect(response.body.deleted).toBeNull()
    expect(await listed()).toEqual([id])
    expect(await ObservationModel.findById(id).lean()).not.toHaveProperty('deleted')
    // Restoring one that is not deleted is refused.
    expect((await restore(id)).status).toBe(409)
  })

  it('refuses to change a deleted observation until it is restored', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const saved = (await save({ note: 'Valve V-12.' })).body
    await settled(saved.id)
    await remove(saved.id)

    expect((await edit(saved.id, { severity: 'low' })).status).toBe(409)
    expect((await correct(saved.id, saved.recordings[0].id, 'Text.')).status).toBe(409)
    expect((await ObservationModel.findById(saved.id).lean())?.severity).toBe('high')
  })

  it('keeps a location while a deleted observation is saved there', async () => {
    await assessmentWithSession()
    const { id } = (await note({ locationId: String(PUMP_HOUSE) })).body
    await remove(id)

    const response = await api.delete(`/api/assessments/RPT-2026-0411/locations/${PUMP_HOUSE}`)

    expect(response.status).toBe(409)
    expect(response.body.error).toBe(
      "Pump house has 1 observation, 1 of them deleted. It can't be removed while they are saved there.",
    )
  })
})

describe('who can change an observation (CP-08 AC17)', () => {
  it('lets only the assigned engineer change it, and no one once archived', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Valve chained open.' }))
    const assessment = await assessmentWithSession()
    const saved = (await save({ note: 'Valve V-12.' })).body
    await settled(saved.id)
    const recordingId = saved.recordings[0].id
    const attempts = (as: ReturnType<typeof signedInAs>) => [
      as.patch(`/api/observations/${saved.id}`).send({ severity: 'low' }),
      as.patch(`/api/observations/${saved.id}`).send({ note: 'Rewritten.' }),
      as.put(`/api/observations/${saved.id}/recordings/${recordingId}/transcript`).send({
        text: 'Rewritten.',
      }),
      as.delete(`/api/observations/${saved.id}`),
      as.post(`/api/observations/${saved.id}/restore`),
    ]

    const otherEngineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')
    const admin = signedInAsRole(app, 'knowledge_admin')
    for (const as of [otherEngineer, admin]) {
      for (const response of await Promise.all(attempts(as))) expect(response.status).toBe(403)
    }
    // A knowledge admin can still read them.
    expect((await admin.get('/api/assessments/RPT-2026-0411/observations')).status).toBe(200)

    await AssessmentModel.updateOne({ _id: assessment._id }, { archivedAt: new Date() })
    for (const response of await Promise.all(attempts(api))) expect(response.status).toBe(409)

    const stored = await ObservationModel.findById(saved.id).lean()
    expect(stored).toMatchObject({ severity: 'high', note: 'Valve V-12.' })
    expect(stored?.recordings[0].transcription.correction).toBeUndefined()
    expect(stored).not.toHaveProperty('deleted')
    expect(stored).not.toHaveProperty('edited')
  })
})

describe('observation list, audio and restarts', () => {
  it.each([
    ['Error code: 413 - Maximum content size limit (26214400) exceeded', /too long or too large/],
    ['Invalid file format. Supported formats: flac, mp3, wav', /format is not supported/],
    ['Audio file is too short. Minimum audio length is 0.1 seconds.', /No speech was heard/],
    ['Error code: 429 - rate limit reached', /usage limit.*Try again later/],
    ['Error code: 503 - the server is overloaded', /busy.*Try again later/],
    ['Request timed out.', /took too long.*Try again later/],
    ['The speech service could not be reached.', /could not be reached.*Try again later/],
  ])('shows a short reason for a failed recording: %s', async (detail, reason) => {
    speech.mockReturnValue(
      s5(502, { detail: `Whisper could not transcribe the recording: ${detail}` }),
    )
    await assessmentWithSession()
    await settled((await save()).body.id)
    const response = await api.get('/api/assessments/RPT-2026-0411/observations')
    expect(response.body[0].recordings[0].transcription.error).toMatch(reason)
  })

  it('shows a short storage failure reason while retaining technical details for diagnosis', async () => {
    const detail =
      'The recording could not be read from storage: SSL validation failed for https://example-bucket.s3.amazonaws.com/audio/private-recording.webm [Errno 2] No such file or directory'
    speech.mockReturnValue(s5(502, { detail }))
    await assessmentWithSession()
    const saved = (await save()).body
    const stored = await settled(saved.id)
    expect(stored.recordings[0].transcription.error).toBe(detail)
    expect(stored.recordings[0].transcription.attempts[0].error).toBe(detail)
    const response = await api.get('/api/assessments/RPT-2026-0411/observations')
    expect(response.body[0].recordings[0].transcription.error).toBe(
      'Could not securely connect to audio storage.',
    )
    expect(JSON.stringify(response.body)).not.toContain('example-bucket')
  })

  it('lists the observations newest first, with each recording and its transcription', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Racking is new.' }))
    await assessmentWithSession()
    const first = (await save()).body
    await settled(first.id)
    const second = (await note({ copeDimensions: null })).body

    const response = await api.get('/api/assessments/RPT-2026-0411/observations')

    expect(response.status).toBe(200)
    expect(response.body.map((o: { id: string }) => o.id)).toEqual([second.id, first.id])
    expect(response.body[1]).toMatchObject({
      engineer: 'Alex Rowe',
      copeDimensions: ['Protection'],
      location: { id: String(BAY_3), name: 'Bay 3 — north aisle' },
      note: null,
      recordings: [
        {
          id: first.recordings[0].id,
          name: 'Recording 1',
          url: `/api/observations/${first.id}/recordings/${first.recordings[0].id}/audio`,
          transcription: {
            status: 'transcribed',
            transcript: 'Racking is new.',
            error: null,
            attempts: 1,
          },
        },
      ],
    })
  })

  it('streams the original recording back', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'x' }))
    await assessmentWithSession()
    const { id, recordings } = (await save()).body

    const response = await api.get(recordings[0].url).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('audio/webm')
    expect(Buffer.from(response.body)).toEqual(AUDIO)
    expect((await api.get(`/api/observations/${id}/recordings/nope/audio`)).status).toBe(404)
    await settled(id)
  })

  it('plays the recording in parts when asked with a Range header', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'x' }))
    await assessmentWithSession()
    const { id, recordings } = (await save()).body

    const part = await api.get(recordings[0].url).set('Range', 'bytes=2-5').buffer(true)

    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 2-5/${AUDIO.length}`)
    expect(part.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(part.body)).toEqual(AUDIO.subarray(2, 6))
    await settled(id)
  })

  it('puts transcriptions interrupted by a restart back on the queue instead of failing them (CP-22)', async () => {
    speech.mockReturnValue(new Promise<Response>(() => {}))
    await assessmentWithSession()
    const { id } = (await save({}, [{}, {}])).body
    await vi.waitFor(() => expect(speech).toHaveBeenCalledTimes(2))
    speech.mockClear()

    await resumeInterruptedTranscriptions()

    await vi.waitFor(() => expect(speech).toHaveBeenCalledTimes(2))
    const stored = await ObservationModel.findById(id).lean()
    for (const r of stored!.recordings) expect(r.transcription.status).toBe('transcribing')
  })
})

// Only the first bytes decide the format; the rest stands in for the image.
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png body'),
])
// An iPhone's default format, whatever the file is called.
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic....')])

type Photo = { image: Buffer; name?: string; type?: string }
// Saves an observation with a `photo` part per image, as the capture screen does.
function savePhotos(photos: Photo[], fields: object = {}) {
  const req = api.post('/api/assessments/RPT-2026-0411/observations').field(
    'details',
    JSON.stringify({
      copeDimensions: ['Protection'],
      severity: 'moderate',
      locationId: String(BAY_3),
      ...fields,
    }),
  )
  photos.forEach((p, i) =>
    req.attach('photo', p.image, {
      filename: p.name ?? `IMG_04${60 + i}.jpg`,
      contentType: p.type ?? 'image/jpeg',
    }),
  )
  return req
}

describe('site photographs (CP-04)', () => {
  it('stores each photo unaltered as raw evidence, linked to its observation (AC1, AC2, AC5)', async () => {
    await assessmentWithSession()

    const response = await savePhotos([{ image: JPG }, { image: PNG, name: 'riser.png' }])

    expect(response.status).toBe(201)
    const stored = await ObservationModel.findById(response.body.id).lean()
    const [jpg, png] = stored!.photos!
    expect(jpg.key).toBe(`photos/RPT-2026-0411/${response.body.id}/${jpg._id}.jpg`)
    expect(png.key).toMatch(/\.png$/)
    expect(s3.get(jpg.key)).toEqual(JPG)
    expect(s3.get(png.key)).toEqual(PNG)
    // A photo on its own is an observation; nothing is transcribed.
    expect(response.body).toMatchObject({
      note: null,
      recordings: [],
      engineerId: String(actor._id),
      photos: [
        {
          type: 'Photo',
          id: String(jpg._id),
          name: 'IMG_0460.jpg',
          contentType: 'image/jpeg',
          size: JPG.length,
          url: `/api/observations/${response.body.id}/photos/${jpg._id}/image`,
        },
        { name: 'riser.png', contentType: 'image/png' },
      ],
    })
    expect(String(stored?.engineerId)).toBe(String(actor._id))
    expect(speech).not.toHaveBeenCalled()
    const [listed] = (await api.get('/api/assessments/RPT-2026-0411/observations')).body
    expect(listed.photos).toEqual(response.body.photos)
  })

  it('streams the original photo back', async () => {
    await assessmentWithSession()
    const { id, photos } = (await savePhotos([{ image: PNG }])).body

    const response = await api.get(photos[0].url).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(Buffer.from(response.body)).toEqual(PNG)
    expect((await api.get(`/api/observations/${id}/photos/nope/image`)).status).toBe(404)
    const unknown = `/api/observations/${id}/photos/${new Types.ObjectId()}/image`
    expect((await api.get(unknown)).status).toBe(404)
  })

  it('takes the format from the image itself, not the type the browser sent', async () => {
    await assessmentWithSession()

    const response = await savePhotos([
      { image: JPG, name: 'image', type: 'application/octet-stream' },
    ])

    expect(response.status).toBe(201)
    expect(response.body.photos[0].contentType).toBe('image/jpeg')
  })

  it('refuses anything but a JPG or PNG with a format message, saving nothing (AC4)', async () => {
    await assessmentWithSession()

    for (const photo of [
      { image: HEIC, name: 'IMG_0461.jpg' },
      { image: HEIC, name: 'IMG_0461.HEIC', type: 'image/heic' },
      { image: Buffer.from('GIF89a....'), name: 'map.gif', type: 'image/gif' },
    ]) {
      // One unsupported photo refuses the whole observation, the good one too.
      const response = await savePhotos([{ image: JPG }, photo], { note: 'Riser room.' })
      expect(response.status).toBe(415)
      expect(response.body.error).toBe(
        `${photo.name} is not a JPG or PNG image. Save it as JPG or PNG and add it again.`,
      )
    }
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('refuses an empty photo or one over 20 MB', async () => {
    await assessmentWithSession()

    expect((await savePhotos([{ image: Buffer.from('') }])).status).toBe(400)
    const huge = Buffer.concat([JPG, Buffer.alloc(20 * 1024 * 1024)])
    expect((await savePhotos([{ image: huge }])).status).toBe(413)
    expect(s3.size).toBe(0)
  })

  it('lets an observation with a photo drop its note (CP-08 AC8)', async () => {
    await assessmentWithSession()
    const { id } = (await savePhotos([{ image: JPG }], { note: 'Riser room.' })).body

    const response = await api.patch(`/api/observations/${id}`).send({ note: null })

    expect(response.status).toBe(200)
    expect(response.body.note).toBeNull()
  })

  it('lists an observation saved before photos existed with none', async () => {
    const assessment = await assessmentWithSession()
    const session = await CaptureSessionModel.findOne({ assessment: assessment._id }).lean()
    // Written without Mongoose, which would add an empty list.
    await ObservationModel.collection.insertOne({
      assessment: assessment._id,
      session: session!._id,
      engineer: 'Alex Rowe',
      note: 'Saved before CP-04.',
      recordings: [],
      severity: 'low',
      location: BAY_3,
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: null,
        effective_date: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const [listed] = (await api.get('/api/assessments/RPT-2026-0411/observations')).body

    expect(listed.photos).toEqual([])
    // Its note still can't be removed: it has nothing else.
    expect((await api.patch(`/api/observations/${listed.id}`).send({ note: null })).status).toBe(
      400,
    )
  })
})

describe('reading an observation (CP-05, CP-21)', () => {
  const PROTECTION = {
    category: 'Protection',
    reason: 'The note says racking sits under the heads; IMG_0460.jpg shows it.',
    evidence: [
      { item: 'Note', quote: 'racking under the heads' },
      { item: 'IMG_0460.jpg', quote: null },
    ],
  }
  const PROPOSAL = {
    categories: [PROTECTION],
    description:
      'During the site visit to Bay 3, it was observed that the new racking sits under two sprinkler heads.',
    hazard_type: 'Sprinkler Installation',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'cp21-v1',
    usage: { input_tokens: 2064, output_tokens: 48, thought_tokens: 180 },
  }
  // What S5 answers for a reading without photos: categories only.
  const TEXT_ONLY = { ...PROPOSAL, description: null, hazard_type: null }
  const listed = async () => (await api.get('/api/assessments/RPT-2026-0411/observations')).body
  const read = (id: string) => api.post(`/api/observations/${id}/interpretation`)

  // Interpretation runs after the response, so wait for it to settle.
  async function interpreted(id: string) {
    await vi.waitFor(async () => {
      const o = await ObservationModel.findById(id).lean()
      expect(o?.interpretation?.status).not.toBe('interpreting')
    })
    return (await ObservationModel.findById(id).lean())!
  }
  // Saves photos, then asks for the observation to be read, as the Observations tab does.
  async function readSaved(photos: Photo[] = [{ image: JPG }], fields: object = {}) {
    const { id } = (await savePhotos(photos, fields)).body
    expect((await read(id)).status).toBe(202)
    return id as string
  }

  it('sends nothing to the model when an observation is saved', async () => {
    await assessmentWithSession()

    const photos = await savePhotos([{ image: JPG }, { image: PNG }])
    const noted = await note()

    for (const response of [photos, noted]) {
      expect(response.status).toBe(201)
      expect(response.body.interpretation).toBeNull()
      const stored = await ObservationModel.findById(response.body.id).lean()
      expect(stored?.interpretation).toBeUndefined()
    }
    expect(vision).not.toHaveBeenCalled()
  })

  it('reads the photos and the note, each by its name, with the location (AC1, AC2)', async () => {
    let finish!: (reply: Response) => void
    vision.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)))
    await assessmentWithSession()
    const { id } = (
      await savePhotos([{ image: JPG }, { image: PNG }], { note: 'Racking under the heads.' })
    ).body

    expect((await read(id)).status).toBe(202)

    const stored = await ObservationModel.findById(id).lean()
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
    expect(vision).toHaveBeenCalledWith({
      photos: stored!.photos!.map((p) => ({ label: p.name, s3_key: p.key })),
      texts: [{ label: 'Note', kind: 'note', text: 'Racking under the heads.' }],
      location: 'Bay 3 — north aisle, Ground',
      // Both parts in one call the first time (CP-21).
      parts: ['categories', 'description'],
      // Off unless PII_PROTECTION requires it (PV-04).
      privacy: { enabled: false, known_entities: [], check_answers: false },
    })
    expect(speech).not.toHaveBeenCalled()
    // Listed as interpreting while it runs (AC2), naming what it reads.
    expect((await listed())[0].interpretation).toEqual({
      status: 'interpreting',
      photos: {
        status: 'interpreting',
        description: null,
        hazardType: null,
        error: null,
        attempts: 1,
        model: null,
        photoIds: stored!.photos!.map((p) => String(p._id)),
        outOfDate: false,
      },
      categories: [],
      error: null,
      attempts: 1,
      model: null,
      photoIds: stored!.photos!.map((p) => String(p._id)),
      items: [
        { label: 'Note', kind: 'note', id: null, leftOut: false },
        ...stored!.photos!.map((p) => ({
          label: p.name,
          kind: 'photo',
          id: String(p._id),
          leftOut: false,
        })),
      ],
      outOfDate: false,
    })
    finish(await s5(200, PROPOSAL))
    await interpreted(id)
  })

  it('stores the proposal and what wrote it, leaving the engineer’s own record alone (AC3-AC5)', async () => {
    vision.mockReturnValue(s5(200, PROPOSAL))
    await assessmentWithSession()
    const id = await readSaved([{ image: JPG }], {
      copeDimensions: null,
      note: 'Racking under the heads.',
    })

    const done = await interpreted(id)

    expect(done.interpretation).toMatchObject({
      status: 'interpreted',
      photoReading: {
        status: 'interpreted',
        description: PROPOSAL.description,
        hazardType: 'Sprinkler Installation',
        provenance: { promptVersion: 'cp21-v1' },
      },
      provenance: {
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        promptVersion: 'cp21-v1',
        usage: { inputTokens: 2064, outputTokens: 48, thoughtTokens: 180 },
      },
    })
    expect(done.interpretation!.attempts[0].finishedAt).toBeInstanceOf(Date)
    const [observation] = await listed()
    expect(observation.interpretation).toMatchObject({
      status: 'interpreted',
      photos: {
        status: 'interpreted',
        description: PROPOSAL.description,
        hazardType: 'Sprinkler Installation',
        model: 'gemini-3.8-flash',
        outOfDate: false,
      },
      // The note's words are in the note; a photo has none to check.
      categories: [
        {
          category: 'Protection',
          reason: PROTECTION.reason,
          evidence: [
            { item: 'Note', quote: 'racking under the heads', verified: true },
            { item: 'IMG_0460.jpg', quote: null, verified: null },
          ],
        },
      ],
      error: null,
      attempts: 1,
      model: 'gemini-3.8-flash',
      photoIds: [observation.photos[0].id],
      outOfDate: false,
    })
    // A proposal only: the observation stays uncategorised, its note as typed.
    expect(observation).toMatchObject({ copeDimensions: null, note: 'Racking under the heads.' })
  })

  it('reads an observation without photos for categories only (CP-21)', async () => {
    vision.mockReturnValue(s5(200, TEXT_ONLY))
    speech.mockImplementation(() => s5(200, { transcript: 'Racking under the heads, bay 3.' }))
    await assessmentWithSession()
    const { id } = (await save({ note: 'Bay 3 racking' }, [{}])).body
    await settled(id)

    expect((await read(id)).status).toBe(202)
    const done = await interpreted(id)

    expect(vision).toHaveBeenCalledWith({
      photos: [],
      texts: [
        { label: 'Note', kind: 'note', text: 'Bay 3 racking' },
        { label: 'Recording 1', kind: 'recording', text: 'Racking under the heads, bay 3.' },
      ],
      location: 'Bay 3 — north aisle, Ground',
      parts: ['categories'],
      privacy: { enabled: false, known_entities: [], check_answers: false },
    })
    expect(done.interpretation?.photoReading).toBeUndefined()
    const [observation] = await listed()
    expect(observation.interpretation).toMatchObject({
      status: 'interpreted',
      photos: null,
      categories: [{ category: 'Protection' }],
    })
  })

  it('reads a corrected transcript, and leaves out a recording with none (CP-21)', async () => {
    vision.mockReturnValue(s5(200, TEXT_ONLY))
    speech
      .mockImplementationOnce(() => s5(200, { transcript: 'Valve chaned open.' }))
      .mockImplementationOnce(() => s5(502, { detail: 'Whisper could not transcribe it.' }))
    await assessmentWithSession()
    const { id } = (await save({}, [{}, {}])).body
    // The two are transcribed at once, so either may be the one that failed.
    const { recordings } = await settled(id)
    const heard = recordings.find((r) => r.transcription.status === 'transcribed')!
    await correct(id, String(heard._id), 'Valve chained open.')

    expect((await read(id)).status).toBe(202)
    await interpreted(id)

    expect(vision).toHaveBeenCalledWith(
      expect.objectContaining({
        texts: [{ label: heard.name, kind: 'recording', text: 'Valve chained open.' }],
      }),
    )
    expect((await listed())[0].interpretation.items).toEqual(
      recordings.map((r) => ({
        label: r.name,
        kind: 'recording',
        id: String(r._id),
        leftOut: r !== heard,
      })),
    )
  })

  it('waits for transcriptions still running, and needs something to read (CP-21)', async () => {
    speech.mockReturnValue(new Promise<Response>(() => {}))
    await assessmentWithSession()
    const { id: running } = (await save({ note: 'Riser room.' }, [{}])).body

    const waiting = await read(running)
    expect(waiting.status).toBe(409)
    expect(waiting.body.error).toBe(
      'Its recordings and pages are still being transcribed. Try again once they finish.',
    )

    speech.mockReturnValue(s5(502, { detail: 'Whisper could not transcribe it.' }))
    const { id: unheard } = (await save({}, [{}])).body
    await settled(unheard)
    const nothing = await read(unheard)
    expect(nothing.status).toBe(409)
    expect(nothing.body.error).toBe('This observation has nothing to read yet.')
    expect(vision).not.toHaveBeenCalled()
  })

  it('checks each quote against the item it cites (CP-21)', async () => {
    vision.mockReturnValue(
      s5(200, {
        ...PROPOSAL,
        categories: [
          {
            category: 'Construction',
            reason: 'The note says the wall is unsealed.',
            evidence: [
              // Found whatever its case, spacing and curly quotes.
              { item: 'Note', quote: '“RACKING  under”' },
              // Words the note doesn't have, and an item the observation doesn't have.
              { item: 'Note', quote: 'wall is unsealed' },
              { item: 'Recording 9', quote: 'racking' },
              // A photo has no words: a quote given for one is dropped.
              { item: 'IMG_0460.jpg', quote: 'racking' },
            ],
          },
          // Not a COPE category, so not kept.
          { category: 'Roofing', reason: 'x', evidence: [] },
        ],
      }),
    )
    await assessmentWithSession()
    const id = await readSaved([{ image: JPG }], { note: 'Racking under the heads.' })
    await interpreted(id)

    expect((await listed())[0].interpretation.categories).toEqual([
      {
        category: 'Construction',
        reason: 'The note says the wall is unsealed.',
        evidence: [
          { item: 'Note', quote: '“RACKING  under”', verified: true },
          { item: 'Note', quote: 'wall is unsealed', verified: false },
          { item: 'Recording 9', quote: 'racking', verified: false },
          { item: 'IMG_0460.jpg', quote: null, verified: null },
        ],
      },
    ])
  })

  it('marks a reading out of date when its note or a transcript changes, not for Use as note (CP-21)', async () => {
    vision.mockImplementation(() => s5(200, PROPOSAL))
    speech.mockImplementation(() => s5(200, { transcript: 'Racking under the heads.' }))
    await assessmentWithSession()
    const { id } = (
      await save({ note: 'Bay 3 racking' }, [{}]).attach('photo', JPG, {
        filename: 'IMG_0460.jpg',
        contentType: 'image/jpeg',
      })
    ).body
    const [recording] = (await settled(id)).recordings
    const reading = async () => (await listed())[0].interpretation
    await read(id)
    await vi.waitFor(async () => expect((await reading()).status).toBe('interpreted'))
    expect((await reading()).outOfDate).toBe(false)

    // Taking the description into the note, as Use as note writes it, came from the reading.
    await edit(id, { note: `Bay 3 racking\n\n${PROPOSAL.description}` })
    expect((await reading()).outOfDate).toBe(false)
    // Any other note edit is a change.
    await edit(id, { note: 'Bay 3 racking, roof leaking too.' })
    expect((await reading()).outOfDate).toBe(true)
    // The photos' description reads only the photos, so it stays current.
    expect((await reading()).photos.outOfDate).toBe(false)
    await edit(id, { note: 'Bay 3 racking' })
    expect((await reading()).outOfDate).toBe(false)
    // So is a corrected transcript.
    await correct(id, String(recording._id), 'Racking under three heads.')
    expect((await reading()).outOfDate).toBe(true)

    // Read again: what it holds now.
    expect((await read(id)).status).toBe(202)
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(2))
    expect(vision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        texts: [
          { label: 'Note', kind: 'note', text: 'Bay 3 racking' },
          { label: 'Recording 1', kind: 'recording', text: 'Racking under three heads.' },
        ],
      }),
    )
  })

  it('reads a category proposed before CP-21 as a list of one, with no reason', async () => {
    await assessmentWithSession()
    const { id } = (await savePhotos([{ image: JPG }])).body
    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          interpretation: {
            status: 'interpreted',
            description: 'An earlier reading.',
            copeDimension: 'Protection',
            attempts: [{ startedAt: new Date() }],
          },
        },
      },
    )

    expect((await listed())[0].interpretation).toMatchObject({
      categories: [{ category: 'Protection', reason: null, evidence: [] }],
      outOfDate: false,
    })
  })

  it('marks a reading from before CP-21 out of date when there is a transcript it never read', async () => {
    speech.mockImplementation(() => s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const { id } = (await save({ note: 'Pump house valve.' }, [{}])).body
    await settled(id)
    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          interpretation: {
            status: 'interpreted',
            copeDimension: 'Protection',
            attempts: [{ startedAt: new Date() }],
          },
        },
      },
    )

    expect((await listed())[0].interpretation.outOfDate).toBe(true)
    expect((await read(id)).status).toBe(202)
  })

  it('reads the categories again alone, keeping the description (CP-21)', async () => {
    vision.mockImplementation(() => s5(200, PROPOSAL))
    await assessmentWithSession()
    const id = await readSaved([{ image: JPG }], { note: 'Racking under the heads.' })
    await interpreted(id)

    vision.mockImplementation(() => s5(200, { ...TEXT_ONLY, description: null }))
    expect(
      (await api.post(`/api/observations/${id}/interpretation`).send({ part: 'categories' }))
        .status,
    ).toBe(202)
    const done = await interpreted(id)

    // Every item is still evidence for the categories, photos included.
    expect(vision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        photos: [expect.objectContaining({ label: 'IMG_0460.jpg' })],
        parts: ['categories'],
      }),
    )
    expect(done.interpretation?.attempts).toHaveLength(2)
    expect(done.interpretation?.photoReading).toMatchObject({
      status: 'interpreted',
      description: PROPOSAL.description,
      attempts: [expect.anything()],
    })
  })

  it('reads the description again alone, from the photos and the note (CP-21)', async () => {
    vision.mockImplementation(() => s5(200, PROPOSAL))
    speech.mockImplementation(() => s5(200, { transcript: 'Racking under the heads.' }))
    await assessmentWithSession()
    const { id } = (
      await save({ note: 'Bay 3 racking' }, [{}]).attach('photo', JPG, {
        filename: 'IMG_0460.jpg',
        contentType: 'image/jpeg',
      })
    ).body
    await settled(id)
    await read(id)
    await interpreted(id)

    const DESCRIBED = 'During the site visit to Bay 3, it was observed that racking blocked a head.'
    vision.mockImplementation(() =>
      s5(200, { ...PROPOSAL, categories: null, description: DESCRIBED, hazard_type: 'Other' }),
    )
    expect(
      (await api.post(`/api/observations/${id}/interpretation`).send({ part: 'description' }))
        .status,
    ).toBe(202)
    await vi.waitFor(async () => {
      const o = await ObservationModel.findById(id).lean()
      expect(o?.interpretation?.photoReading?.status).toBe('interpreted')
      expect(o?.interpretation?.photoReading?.description).toBe(DESCRIBED)
    })

    expect(vision).toHaveBeenLastCalledWith({
      photos: [expect.objectContaining({ label: 'IMG_0460.jpg' })],
      // The note guides where to look; transcripts aren't read for a description.
      texts: [{ label: 'Note', kind: 'note', text: 'Bay 3 racking' }],
      location: 'Bay 3 — north aisle, Ground',
      parts: ['description'],
      privacy: { enabled: false, known_entities: [], check_answers: false },
    })
    const [observation] = await listed()
    expect(observation.interpretation).toMatchObject({
      attempts: 1,
      categories: [{ category: 'Protection' }],
      photos: { description: DESCRIBED, hazardType: 'Other', attempts: 2, outOfDate: false },
    })
  })

  it('describes photos added after a reading without them, and refuses a part it cannot read (CP-21)', async () => {
    vision.mockImplementation(() => s5(200, TEXT_ONLY))
    await assessmentWithSession()
    const { id } = (await note()).body
    await read(id)
    await interpreted(id)
    const part = (value: unknown) =>
      api.post(`/api/observations/${id}/interpretation`).send({ part: value })

    const none = await part('description')
    expect(none.status).toBe(409)
    expect(none.body.error).toBe('This observation has no photos to describe.')
    expect((await part('summary')).status).toBe(400)

    await ObservationModel.updateOne(
      { _id: id },
      { $push: { photos: { name: 'IMG_0461.jpg', key: 'k', contentType: 'image/jpeg', size: 9 } } },
    )
    vision.mockImplementation(() => s5(200, { ...PROPOSAL, categories: null }))
    expect((await part('description')).status).toBe(202)
    await vi.waitFor(async () =>
      expect((await listed())[0].interpretation.photos).toMatchObject({
        status: 'interpreted',
        description: PROPOSAL.description,
      }),
    )
  })

  it('keeps a description read before the parts were split when the categories are read again', async () => {
    vision.mockImplementation(() => s5(200, { ...TEXT_ONLY }))
    await assessmentWithSession()
    const { id, photos } = (await savePhotos([{ image: JPG }], { note: 'Riser room.' })).body
    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          interpretation: {
            status: 'interpreted',
            description: 'An earlier reading.',
            hazardType: 'Other',
            categories: [],
            items: [],
            photoIds: [new Types.ObjectId(photos[0].id)],
            attempts: [{ startedAt: new Date() }],
          },
        },
      },
    )
    // Shown as its photos' part.
    expect((await listed())[0].interpretation.photos).toMatchObject({
      status: 'interpreted',
      description: 'An earlier reading.',
      outOfDate: false,
    })

    await api.post(`/api/observations/${id}/interpretation`).send({ part: 'categories' })
    await interpreted(id)

    const stored = (await ObservationModel.findById(id).lean())!.interpretation!
    expect(stored.description).toBeUndefined()
    expect(stored.photoReading).toMatchObject({
      status: 'interpreted',
      description: 'An earlier reading.',
    })
  })

  it('records usage as unavailable when the provider reports none', async () => {
    vision.mockReturnValue(s5(200, { ...PROPOSAL, usage: null }))
    await assessmentWithSession()

    const done = await interpreted(await readSaved())

    expect(done.interpretation?.provenance?.usage).toBeNull()
    // EV-03 AC7: the AI call is still recorded, its usage marked unavailable, never 0.
    expect(await AiCallModel.findOne().lean()).toMatchObject({
      feature: 'interpret-photo',
      billedService: 'gemini-vision',
      usageStatus: 'unavailable',
      inputTokens: null,
      estimatedCostUsd: null,
    })
  })

  it('records the AI call against the assessment, thinking billed as output (EV-03)', async () => {
    vision.mockReturnValue(s5(200, PROPOSAL))
    await assessmentWithSession()

    await interpreted(await readSaved())

    const rows = await AiCallModel.find().lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      feature: 'interpret-photo',
      billedService: 'gemini-vision',
      model: 'gemini-3.8-flash',
      reportId: 'RPT-2026-0411',
      inputTokens: 2064,
      // 48 answer + 180 thinking tokens: Google bills both as output.
      outputTokens: 228,
      usageStatus: 'recorded',
      callCount: 1,
    })
    expect(rows[0].durationMs).toEqual(expect.any(Number))
    expect(rows[0].estimatedCostUsd).toBeGreaterThan(0)
    expect(rows[0].pricingBasis).toContain('ai.google.dev')
  })

  it('records nothing when the AI service fails, as it returns no usage', async () => {
    vision.mockReturnValue(s5(502, { detail: 'The observation could not be read: timeout.' }))
    await assessmentWithSession()

    await interpreted(await readSaved())

    expect(await AiCallModel.countDocuments()).toBe(0)
  })

  it('shows why it failed, and reads again after a failure or whenever asked', async () => {
    vision.mockReturnValue(
      s5(502, { detail: 'The observation could not be read: 403 API key not valid.' }),
    )
    await assessmentWithSession()
    const id = await readSaved()

    const failed = await interpreted(id)

    // The detail is kept with the attempt; the engineer sees a readable reason.
    expect(failed.interpretation).toMatchObject({
      status: 'failed',
      error: 'The observation could not be read: 403 API key not valid.',
    })
    expect((await listed())[0].interpretation.error).toBe(
      'The AI service could not read this observation.',
    )

    vision.mockReturnValue(s5(200, PROPOSAL))
    expect((await read(id)).status).toBe(202)
    const done = await interpreted(id)
    expect(done.interpretation?.status).toBe('interpreted')
    expect(done.interpretation?.attempts).toHaveLength(2)
    expect(done.interpretation?.error).toBeUndefined()

    // Asked again while up to date, a new reading replaces it (CP-21).
    vision.mockImplementation(() => s5(200, PROPOSAL))
    expect((await read(id)).status).toBe(202)
    const anew = await interpreted(id)
    expect(anew.interpretation?.status).toBe('interpreted')
    expect(anew.interpretation?.attempts).toHaveLength(3)
    expect(vision).toHaveBeenCalledTimes(3)
  })

  it('says when the AI service is out of quota or busy, as for a reading saved before CP-21', async () => {
    await assessmentWithSession()
    const { id } = (await savePhotos([{ image: JPG }])).body
    const reason = async (error: string) => {
      await ObservationModel.updateOne(
        { _id: id },
        { interpretation: { status: 'failed', error, attempts: [{ startedAt: new Date() }] } },
      )
      return (await listed())[0].interpretation.error
    }

    expect(await reason('The observation could not be read: Error code: 429')).toBe(
      'The AI service has reached its usage limit. Try again later.',
    )
    expect(await reason('The observation could not be read: Error code: 503')).toBe(
      'The AI service is busy. Try again in a minute.',
    )
    expect(await reason('The photos could not be interpreted: bad key')).toBe(
      'The AI service could not read this observation.',
    )
  })

  it('starts one reading when asked twice at once', async () => {
    await assessmentWithSession()
    const { id } = (await savePhotos([{ image: JPG }])).body

    const replies = await Promise.all([read(id), read(id)])

    expect(replies.map((r) => r.status).sort()).toEqual([202, 409])
    const stored = await ObservationModel.findById(id).lean()
    expect(stored?.interpretation?.attempts).toHaveLength(1)
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
  })

  it('refuses to read a deleted observation or an unknown one', async () => {
    await assessmentWithSession()
    const { id } = (await savePhotos([{ image: JPG }])).body
    await api.delete(`/api/observations/${id}`)
    expect((await read(id)).status).toBe(409)

    expect((await read(String(new Types.ObjectId()))).status).toBe(404)
    expect((await read('nope')).status).toBe(404)
    expect(vision).not.toHaveBeenCalled()
  })

  it('says so when the AI service cannot be reached', async () => {
    vision.mockRejectedValue(new TypeError('fetch failed'))
    await assessmentWithSession()

    const done = await interpreted(await readSaved())

    expect(done.interpretation?.error).toBe('The AI service could not be reached.')
  })

  it('marks interpretations interrupted by a restart as failed so they can be read again', async () => {
    await assessmentWithSession()
    const id = await readSaved()

    await failInterruptedInterpretations()

    // Each part still running is failed, ready to retry (CP-21).
    expect((await ObservationModel.findById(id).lean())?.interpretation).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/interrupted by a gateway restart/),
      photoReading: {
        status: 'failed',
        error: expect.stringMatching(/interrupted by a gateway restart/),
      },
    })
  })

  describe('PII protection (PV-04)', () => {
    afterEach(() => {
      config.piiProtection = 'off'
      config.piiCheckAnswers = true
    })

    it("asks S5 to check the AI's answer when protection is required", async () => {
      config.piiProtection = 'required'
      vision.mockReturnValue(s5(200, PROPOSAL))
      await assessmentWithSession()

      await interpreted(await readSaved())

      expect(vision.mock.calls[0][0].privacy.check_answers).toBe(true)
    })

    it("leaves the AI's answer unchecked when PII_CHECK_ANSWERS is off", async () => {
      config.piiProtection = 'required'
      config.piiCheckAnswers = false
      vision.mockReturnValue(s5(200, PROPOSAL))
      await assessmentWithSession()

      await interpreted(await readSaved())

      expect(vision.mock.calls[0][0].privacy).toMatchObject({ enabled: true, check_answers: false })
    })

    it('checks no answer when protection is off', async () => {
      vision.mockReturnValue(s5(200, PROPOSAL))
      await assessmentWithSession()

      await interpreted(await readSaved())

      expect(vision.mock.calls[0][0].privacy.check_answers).toBe(false)
    })

    it("sends the assessment's known details when protection is required", async () => {
      config.piiProtection = 'required'
      vision.mockReturnValue(s5(200, PROPOSAL))
      await assessmentWithSession()

      await interpreted(await readSaved([{ image: JPG }], { note: 'Racking under the heads.' }))

      expect(vision.mock.calls[0][0]).toMatchObject({
        privacy: {
          enabled: true,
          known_entities: expect.arrayContaining([
            { type: 'CLIENT', names: ['Northgate Logistics'] },
            { type: 'SITE', names: ['Tilbury Distribution Centre', 'SITE-0001'] },
          ]),
        },
      })
    })

    it('sends protection off, with no details, when it is not required', async () => {
      vision.mockReturnValue(s5(200, PROPOSAL))
      await assessmentWithSession()

      await interpreted(await readSaved())

      expect(vision.mock.calls[0][0]).toMatchObject({
        privacy: { enabled: false, known_entities: [] },
      })
    })

    it('records what was protected with each part, never the values (Rule 8)', async () => {
      config.piiProtection = 'required'
      vision.mockReturnValue(
        s5(200, {
          ...PROPOSAL,
          privacy: { enabled: true, masked_count: 2, faces_blurred: 1, removed_from_answer: 1 },
        }),
      )
      await assessmentWithSession()

      const done = await interpreted(await readSaved())

      const privacy = { enabled: true, maskedCount: 2, facesBlurred: 1, removedFromAnswer: 1 }
      expect(done.interpretation?.provenance?.privacy).toEqual(privacy)
      expect(done.interpretation?.photoReading?.provenance?.privacy).toEqual(privacy)
    })

    it('shows why nothing was sent when the details could not be protected', async () => {
      // Passed when first run: S5's wording is already readable, so it is shown as is.
      const reason =
        "Client details couldn't be protected because the privacy service isn't available, " +
        'so nothing was sent to the AI model. If this keeps happening, tell your administrator.'
      config.piiProtection = 'required'
      vision.mockReturnValue(s5(502, { detail: reason }))
      await assessmentWithSession()

      await interpreted(await readSaved())

      const { interpretation } = (await listed())[0]
      expect(interpretation.error).toBe(reason)
      expect(interpretation.photos.error).toBe(reason)
    })

    it('keeps each photo with a face as it was sent, beside the untouched original', async () => {
      config.piiProtection = 'required'
      const BLURRED = Buffer.from('blurred jpeg')
      vision.mockReturnValue(
        s5(200, {
          ...PROPOSAL,
          redacted_photos: [
            { label: 'IMG_0460.jpg', faces: 2, image: BLURRED.toString('base64') },
            { label: 'IMG_0461.png', faces: 0, image: Buffer.from('as sent').toString('base64') },
          ],
        }),
      )
      await assessmentWithSession()

      const done = await interpreted(
        await readSaved([{ image: JPG }, { image: PNG, name: 'IMG_0461.png', type: 'image/png' }]),
      )

      const [withFace, withoutFace] = done.photos!
      const copy = withFace.key.replace(/\.jpg$/, '.redacted.jpg')
      expect(s3.get(copy)).toEqual(BLURRED)
      expect(s3.get(withFace.key)).toEqual(JPG)
      expect(withFace.redaction).toMatchObject({ key: copy, faces: 2, size: BLURRED.length })
      // Checked, and no face: nothing to keep, as it went out as taken (only shrunk).
      expect(withoutFace.redaction).toMatchObject({ key: null, faces: 0 })
      expect(s3.get(withoutFace.key)).toEqual(PNG)
      expect([...s3.keys()].filter((k) => k.includes('.redacted.'))).toEqual([copy])
    })

    it('lists each photo with how it last went to the model', async () => {
      config.piiProtection = 'required'
      vision.mockReturnValue(
        s5(200, {
          ...PROPOSAL,
          redacted_photos: [
            { label: 'IMG_0460.jpg', faces: 2, image: 'Ymx1cnJlZA==' },
            { label: 'IMG_0461.jpg', faces: 0, image: 'YXMgc2VudA==' },
          ],
        }),
      )
      await assessmentWithSession()
      const id = await readSaved([{ image: JPG }, { image: JPG }])
      await interpreted(id)
      const unread = (await savePhotos([{ image: JPG }])).body

      const observations: { id: string; photos: { id: string; redaction: unknown }[] }[] =
        await listed()

      const read = observations.find((o) => o.id === id)!
      const saved = observations.find((o) => o.id === unread.id)!
      const [withFace, withoutFace] = read.photos
      expect(withFace.redaction).toEqual({
        url: `/api/observations/${id}/photos/${withFace.id}/redacted`,
        faces: 2,
      })
      expect(withoutFace.redaction).toEqual({ url: null, faces: 0 })
      // Never read with protection on.
      expect(saved.photos[0].redaction).toBeNull()
    })

    it('streams the copy as it was sent, and only where there is one', async () => {
      config.piiProtection = 'required'
      const BLURRED = Buffer.from('blurred jpeg')
      vision.mockReturnValue(
        s5(200, {
          ...PROPOSAL,
          redacted_photos: [
            { label: 'IMG_0460.jpg', faces: 1, image: BLURRED.toString('base64') },
            { label: 'IMG_0461.jpg', faces: 0, image: 'YXMgc2VudA==' },
          ],
        }),
      )
      await assessmentWithSession()
      const id = await readSaved([{ image: JPG }, { image: JPG }])
      await interpreted(id)
      const [withFace, withoutFace] = (await listed())[0].photos

      const response = await api.get(withFace.redaction.url).buffer(true)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      expect(Buffer.from(response.body)).toEqual(BLURRED)
      const none = `/api/observations/${id}/photos/${withoutFace.id}/redacted`
      expect((await api.get(none)).status).toBe(404)
      expect((await api.get(`/api/observations/${id}/photos/nope/redacted`)).status).toBe(404)
    })

    it('still gives the proposal when the copy cannot be kept', async () => {
      config.piiProtection = 'required'
      failingWrites.match = /\.redacted\./
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(vision).mockReturnValue(
        s5(200, {
          ...PROPOSAL,
          redacted_photos: [{ label: 'IMG_0460.jpg', faces: 1, image: 'Ymx1cnJlZA==' }],
        }),
      )
      await assessmentWithSession()

      const done = await interpreted(await readSaved())

      // The copy only lets the engineer see what left; the reading itself succeeded.
      expect(done.interpretation?.status).toBe('interpreted')
      expect(done.interpretation?.photoReading?.description).toBe(PROPOSAL.description)
      expect(done.photos![0].redaction).toBeUndefined()
      // Logged without the image.
      expect(String(error.mock.calls)).not.toContain('Ymx1cnJlZA==')
      error.mockRestore()
    })
  })
})

describe('adding and removing recordings and photos (CP-08)', () => {
  const listed = async () => (await api.get('/api/assessments/RPT-2026-0411/observations')).body
  // Sends recordings and photos to add, as the Add media dialog does.
  function addMedia(id: string, recordings: Recording[] = [], photos: Photo[] = [], as = api) {
    const req = as.post(`/api/observations/${id}/media`)
    recordings.forEach((r, i) =>
      req.attach('recording', r.audio ?? AUDIO, {
        filename: r.name ?? `Recording ${i + 1}`,
        contentType: r.type ?? 'audio/webm',
      }),
    )
    photos.forEach((p, i) =>
      req.attach('photo', p.image, {
        filename: p.name ?? `IMG_05${10 + i}.jpg`,
        contentType: p.type ?? 'image/jpeg',
      }),
    )
    return req
  }
  type Kind = 'recordings' | 'photos'
  const remove = (id: string, kind: Kind, itemId: string) =>
    api.delete(`/api/observations/${id}/${kind}/${itemId}`)
  const restore = (id: string, kind: Kind, itemId: string) =>
    api.post(`/api/observations/${id}/${kind}/${itemId}/restore`)
  const by = { id: String(actor._id), name: 'Alex Rowe' }
  const READING = {
    categories: [{ category: 'Protection', reason: 'A photo shows racking.', evidence: [] }],
    description: 'During the site visit to Bay 3, it was observed that racking stood under a head.',
    hazard_type: 'Sprinkler Installation',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'cp21-v1',
    usage: null,
  }

  it('adds recordings and photos to a saved observation, once capture has ended', async () => {
    speech.mockImplementation(() => s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const { id } = (await note()).body
    // Adding is a correction, not capture, so no session is needed.
    await CaptureSessionModel.updateMany({}, { status: 'ready_for_generation' })

    const response = await addMedia(
      id,
      [{ name: 'valve.m4a', type: 'audio/mp4' }],
      [{ image: PNG, name: 'valve.png', type: 'image/png' }],
    )

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      note: 'Hose reel H3 blocked by stacked pallets.',
      recordings: [{ name: 'valve.m4a', added: { by } }],
      photos: [{ name: 'valve.png', contentType: 'image/png', added: { by } }],
      removedRecordings: [],
      removedPhotos: [],
      edited: { by },
      // No photo is read until an engineer asks.
      interpretation: null,
    })
    const stored = await settled(id)
    const [recording] = stored.recordings
    const [photo] = stored.photos!
    expect(recording.key).toBe(`audio/RPT-2026-0411/${id}/${recording._id}.mp4`)
    expect(photo.key).toBe(`photos/RPT-2026-0411/${id}/${photo._id}.png`)
    expect(s3.get(recording.key)).toEqual(AUDIO)
    expect(s3.get(photo.key)).toEqual(PNG)
    // Each recording added is transcribed, as at capture.
    expect(recording.transcription).toMatchObject({
      status: 'transcribed',
      transcript: 'Valve chained open.',
    })
    expect(vision).not.toHaveBeenCalled()
  })

  it('refuses what capture refuses, storing nothing', async () => {
    await assessmentWithSession()
    const { id } = (await note()).body

    const heic = await addMedia(id, [], [{ image: HEIC, name: 'IMG_0461.jpg' }])
    expect(heic.status).toBe(415)
    expect(heic.body.error).toBe(
      'IMG_0461.jpg is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
    )
    expect((await addMedia(id, [{ type: 'audio/aiff' }])).status).toBe(415)
    expect((await addMedia(id, [{ audio: Buffer.from('') }])).status).toBe(400)
    const nothing = await api.post(`/api/observations/${id}/media`).field('note', 'Not media.')
    expect(nothing.status).toBe(400)
    expect(nothing.body.error).toBe('Add a recording, a photo or a page to the observation.')

    expect(s3.size).toBe(0)
    const [o] = await listed()
    expect(o).toMatchObject({ recordings: [], photos: [], edited: null })
  })

  it('lets only the assigned engineer add or remove, and not once deleted or archived', async () => {
    await assessmentWithSession()
    const { id, photos } = (await savePhotos([{ image: JPG }, { image: PNG }])).body
    const other = signedInAs(app, { ...actor, _id: new Types.ObjectId(), name: 'Jide Okafor' })
    const photo = photos[0].id

    expect((await addMedia(id, [], [{ image: JPG }], other)).status).toBe(403)
    expect((await other.delete(`/api/observations/${id}/photos/${photo}`)).status).toBe(403)
    expect((await addMedia(String(new Types.ObjectId()), [], [{ image: JPG }])).status).toBe(404)
    expect((await remove(id, 'photos', String(new Types.ObjectId()))).status).toBe(404)
    expect((await remove(id, 'recordings', 'nope')).status).toBe(404)

    await api.delete(`/api/observations/${id}`)
    expect((await addMedia(id, [], [{ image: JPG }])).status).toBe(409)
    expect((await remove(id, 'photos', photo)).status).toBe(409)
    await api.post(`/api/observations/${id}/restore`)
    await AssessmentModel.updateMany({}, { archivedAt: new Date() })
    expect((await addMedia(id, [], [{ image: JPG }])).status).toBe(409)
    expect((await remove(id, 'photos', photo)).status).toBe(409)

    // Only the two photos saved with it.
    expect(s3.size).toBe(2)
  })

  it('removes a recording without deleting it, and drafting stops using it', async () => {
    speech.mockImplementation(() => s5(200, { transcript: 'Valve chained open.' }))
    await assessmentWithSession()
    const { id } = (await save({ note: 'Pump room.' })).body
    const stored = await settled(id)
    const recordingId = String(stored.recordings[0]._id)

    const response = await remove(id, 'recordings', recordingId)

    expect(response.status).toBe(200)
    expect(response.body.recordings).toEqual([])
    expect(response.body.removedRecordings).toMatchObject([
      { id: recordingId, removed: { by }, transcription: { transcript: 'Valve chained open.' } },
    ])
    expect(response.body.edited).toMatchObject({ by })
    // Kept as raw evidence, in the database and in S3.
    expect(s3.has(stored.recordings[0].key)).toBe(true)
    expect((await ObservationModel.findById(id).lean())!.recordings).toHaveLength(1)
    // Drafting reads only what is kept.
    const [drafting] = await listCategoryObservations('RPT-2026-0411', 'Protection')
    expect(drafting.recordings).toEqual([])
    // Not corrected, retried or removed again until it is restored.
    const transcript = `/api/observations/${id}/recordings/${recordingId}/transcript`
    expect((await api.put(transcript).send({ text: 'Valve locked.' })).status).toBe(409)
    expect(
      (await api.post(`/api/observations/${id}/recordings/${recordingId}/transcription/retry`))
        .status,
    ).toBe(409)
    expect((await remove(id, 'recordings', recordingId)).status).toBe(409)

    const restored = await restore(id, 'recordings', recordingId)
    expect(restored.status).toBe(200)
    expect(restored.body.recordings).toMatchObject([{ id: recordingId }])
    expect(restored.body.removedRecordings).toEqual([])
    expect((await restore(id, 'recordings', recordingId)).status).toBe(409)
  })

  it('refuses to remove the last thing captured, even two removals at once', async () => {
    await assessmentWithSession()
    const { id, photos } = (await savePhotos([{ image: JPG }, { image: PNG }])).body

    const replies = await Promise.all(photos.map((p: { id: string }) => remove(id, 'photos', p.id)))

    expect(replies.map((r) => r.status).sort()).toEqual([200, 409])
    expect(replies.find((r) => r.status === 409)!.body.error).toBe(
      'An observation needs a note, a recording, a photo or a page, so this photo can’t be removed. Add what replaces it first.',
    )
    const [o] = await listed()
    expect(o.photos).toHaveLength(1)
    // With a note, the last photo can go; then the note can't.
    await api.patch(`/api/observations/${id}`).send({ note: 'Riser room.' })
    expect((await remove(id, 'photos', o.photos[0].id)).status).toBe(200)
    expect((await api.patch(`/api/observations/${id}`).send({ note: null })).status).toBe(400)
  })

  it('marks a reading out of date when photos change, and reads those it has now', async () => {
    vision.mockImplementation(() => s5(200, READING))
    await assessmentWithSession()
    const {
      id,
      photos: [first],
    } = (await savePhotos([{ image: JPG }])).body
    const reading = async () => (await listed())[0].interpretation
    await api.post(`/api/observations/${id}/interpretation`)
    await vi.waitFor(async () => expect((await reading()).status).toBe('interpreted'))
    expect(await reading()).toMatchObject({ photoIds: [first.id], outOfDate: false })

    // Adding a photo reads nothing; the reading shows as out of date.
    const added = (await addMedia(id, [], [{ image: PNG, type: 'image/png' }])).body
    const second = added.photos[1].id
    expect(added.interpretation).toMatchObject({ photoIds: [first.id], outOfDate: true })
    expect(vision).toHaveBeenCalledTimes(1)
    // Removing it again brings the reading back up to date.
    expect((await remove(id, 'photos', second)).body.interpretation.outOfDate).toBe(false)
    await restore(id, 'photos', second)
    // Removing the photo it read leaves it out of date too.
    expect((await remove(id, 'photos', first.id)).body.interpretation.outOfDate).toBe(true)

    // Read again: only the photos it has now.
    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(202)
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(2))
    const stored = await ObservationModel.findById(id).lean()
    expect(vision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        photos: [{ label: stored!.photos![1].name, s3_key: stored!.photos![1].key }],
      }),
    )
    await vi.waitFor(async () =>
      expect(await reading()).toMatchObject({
        status: 'interpreted',
        photoIds: [second],
        outOfDate: false,
        attempts: 2,
      }),
    )
  })

  it('treats a reading from before photos could change as reading every photo saved', async () => {
    await assessmentWithSession()
    const { id, photos } = (await savePhotos([{ image: JPG }], { note: 'Riser room.' })).body
    await ObservationModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          interpretation: {
            status: 'interpreted',
            description: 'An earlier reading.',
            attempts: [{ startedAt: new Date() }],
          },
        },
      },
    )
    expect((await listed())[0].interpretation).toMatchObject({
      photoIds: [photos[0].id],
      outOfDate: false,
    })

    const added = (await addMedia(id, [], [{ image: PNG, type: 'image/png' }])).body
    expect(added.interpretation.outOfDate).toBe(true)

    // With every photo removed the reading stays out of date, and the note can still be read.
    await remove(id, 'photos', added.photos[1].id)
    const none = (await remove(id, 'photos', photos[0].id)).body
    expect(none.interpretation).toMatchObject({ photoIds: [photos[0].id], outOfDate: true })
    expect(none.removedPhotos).toHaveLength(2)
    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(202)
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
    expect(vision).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: [],
        texts: [{ label: 'Note', kind: 'note', text: 'Riser room.' }],
      }),
    )
  })
})

it('uses each authenticated capturer ID and ignores forged attribution, while deriving text metadata', async () => {
  const assessment = await assessmentWithSession()
  const another = { ...actor, _id: new Types.ObjectId(), name: 'Jide Okafor' }
  for (const user of [actor, another]) {
    // Only the assigned engineer captures (CP-31 AC8), so each is assigned in turn.
    await AssessmentModel.updateOne({ _id: assessment._id }, { engineer: user._id })
    const reply = await signedInAs(app, user)
      .post('/api/assessments/RPT-2026-0411/observations')
      .field(
        'details',
        JSON.stringify({
          note: 'A note',
          engineer: 'Impersonated user',
          engineerId: String(new Types.ObjectId()),
          copeDimensions: null,
          severity: 'low',
          locationId: String(BAY_3),
        }),
      )
    expect(reply.status).toBe(201)
    expect(reply.body).toMatchObject({
      engineer: user.name,
      engineerId: String(user._id),
      recordings: [],
    })
  }
})

describe('handwritten pages (CP-19)', () => {
  type Page = { image: Buffer; name?: string; type?: string }
  // Saves an observation with a `page` part per photographed page, as Scan mode does.
  function savePages(pages: Page[], fields: object = {}) {
    const req = api.post('/api/assessments/RPT-2026-0411/observations').field(
      'details',
      JSON.stringify({
        copeDimensions: ['Protection'],
        severity: 'moderate',
        locationId: String(BAY_3),
        ...fields,
      }),
    )
    pages.forEach((p, i) =>
      req.attach('page', p.image, {
        filename: p.name ?? `IMG_07${10 + i}.jpg`,
        contentType: p.type ?? 'image/jpeg',
      }),
    )
    return req
  }
  // What S5 answers for a page it transcribed.
  const read = (transcript: string, uncertain: number[][] = []) => ({
    transcript,
    uncertain,
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'cp19-v1',
    usage: [
      {
        feature: 'transcribe-handwriting',
        billed_service: 'gemini-vision',
        model: 'gemini-3.8-flash',
        duration_ms: 2100,
        input_tokens: 1290,
        output_tokens: 275,
        cache_read_tokens: null,
        search_units: null,
        audio_seconds: null,
        usage_status: 'recorded',
      },
    ],
  })
  // Transcription runs after the response, so wait for every page to settle.
  async function pagesSettled(id: string) {
    await vi.waitFor(async () => {
      const o = await ObservationModel.findById(id).lean()
      expect(o?.pages?.map((p) => p.transcription.status)).not.toContain('transcribing')
    })
    return (await ObservationModel.findById(id).lean())!
  }
  const listed = async () => (await api.get('/api/assessments/RPT-2026-0411/observations')).body

  it('stores each page unaltered as raw evidence and transcribes it on its own (AC1, AC6, AC8)', async () => {
    handwriting.mockImplementation(({ s3_key }) =>
      s5(200, read(`Text of ${s3_key.split('/').pop()}`, [[0, 4]])),
    )
    await assessmentWithSession()

    const response = await savePages([{ image: JPG }, { image: PNG, name: 'page-2.png' }])

    expect(response.status).toBe(201)
    const id = response.body.id
    const stored = await pagesSettled(id)
    const [first, second] = stored.pages!
    expect(first.key).toBe(`pages/RPT-2026-0411/${id}/${first._id}.jpg`)
    expect(second.key).toMatch(/\.png$/)
    expect(s3.get(first.key)).toEqual(JPG)
    expect(s3.get(second.key)).toEqual(PNG)
    // One transcription per page, each of its own page.
    expect(handwriting).toHaveBeenCalledTimes(2)
    expect(handwriting.mock.calls.map(([body]) => body.s3_key).sort()).toEqual(
      [first.key, second.key].sort(),
    )
    expect(String(stored.engineerId)).toBe(String(actor._id))
    const [o] = await listed()
    expect(o).toMatchObject({
      note: null,
      recordings: [],
      // Not a site photo (AC5).
      photos: [],
      pages: [
        {
          type: 'Scan',
          id: String(first._id),
          name: 'IMG_0710.jpg',
          contentType: 'image/jpeg',
          size: JPG.length,
          url: `/api/observations/${id}/pages/${first._id}/image`,
          transcription: {
            status: 'transcribed',
            transcript: `Text of ${first._id}.jpg`,
            uncertain: [[0, 4]],
            error: null,
            attempts: 1,
            model: 'gemini-3.8-flash',
          },
        },
        { name: 'page-2.png', contentType: 'image/png' },
      ],
    })
    expect(stored.pages![0].transcription.provenance).toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      promptVersion: 'cp19-v1',
    })
    expect(speech).not.toHaveBeenCalled()
  })

  it('records each transcription against the assessment (EV-03)', async () => {
    handwriting.mockReturnValue(s5(200, read('spk CV shut')))
    await assessmentWithSession()

    await pagesSettled((await savePages([{ image: JPG }])).body.id)

    expect(await AiCallModel.find().lean()).toMatchObject([
      {
        feature: 'transcribe-handwriting',
        billedService: 'gemini-vision',
        model: 'gemini-3.8-flash',
        reportId: 'RPT-2026-0411',
        inputTokens: 1290,
        outputTokens: 275,
        usageStatus: 'recorded',
      },
    ])
  })

  it('keeps a page with no handwriting, with an empty transcript (AC10)', async () => {
    handwriting.mockReturnValue(s5(200, read('')))
    await assessmentWithSession()

    await pagesSettled((await savePages([{ image: JPG }])).body.id)

    const [o] = await listed()
    expect(o.pages[0].transcription).toMatchObject({ status: 'transcribed', transcript: '' })
  })

  it('keeps only uncertain words that lie within the transcript', async () => {
    handwriting.mockReturnValue(
      s5(
        200,
        read('valve shut', [
          [0, 5],
          [6, 99],
          [8, 7],
          [1.5, 3],
        ]),
      ),
    )
    await assessmentWithSession()

    await pagesSettled((await savePages([{ image: JPG }])).body.id)

    expect((await listed())[0].pages[0].transcription.uncertain).toEqual([[0, 5]])
  })

  it('refuses anything but a JPG or PNG, an empty page or one over 20 MB, saving nothing (AC2)', async () => {
    await assessmentWithSession()

    const heic = await savePages([{ image: JPG }, { image: HEIC, name: 'notes.heic' }], {
      note: 'Riser room.',
    })
    expect(heic.status).toBe(415)
    expect(heic.body.error).toBe(
      'notes.heic is not a JPG or PNG image. Save it as JPG or PNG and add it again.',
    )
    expect((await savePages([{ image: Buffer.from('') }])).status).toBe(400)
    const huge = Buffer.concat([JPG, Buffer.alloc(20 * 1024 * 1024)])
    const tooBig = await savePages([{ image: huge }])
    expect(tooBig.status).toBe(413)
    expect(tooBig.body.error).toBe('A page is larger than 20 MB. Upload a smaller one.')
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
    expect(handwriting).not.toHaveBeenCalled()
  })

  it('shows why a page failed, leaving the others, and retries it on its own (AC6, AC11)', async () => {
    handwriting.mockImplementation(({ s3_key }) =>
      s3_key.endsWith('.png')
        ? s5(502, {
            detail: 'The page could not be transcribed: the answer was not in the expected form.',
          })
        : s5(200, read('FHR 7 bar')),
    )
    await assessmentWithSession()
    const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body
    const stored = await pagesSettled(id)
    const failed = stored.pages![1]
    expect(failed.transcription.attempts[0].error).toContain(
      'the answer was not in the expected form',
    )

    let [o] = await listed()
    const statuses = o.pages.map(
      (p: { transcription: { status: string } }) => p.transcription.status,
    )
    expect(statuses).toEqual(['transcribed', 'failed'])
    expect(o.pages[1].transcription.error).toBe(
      'The handwriting service could not transcribe the page.',
    )

    const retry = (pageId: unknown) =>
      api.post(`/api/observations/${id}/pages/${pageId}/transcription/retry`)
    // Only a failed page can be retried.
    expect((await retry(stored.pages![0]._id)).status).toBe(409)
    handwriting.mockReturnValue(s5(200, read('Second time lucky.')))
    expect((await retry(failed._id)).status).toBe(202)
    await pagesSettled(id)
    ;[o] = await listed()
    expect(o.pages[1].transcription).toMatchObject({
      status: 'transcribed',
      transcript: 'Second time lucky.',
      error: null,
      attempts: 2,
    })
    expect(handwriting).toHaveBeenLastCalledWith({ s3_key: failed.key })
    expect((await retry(new Types.ObjectId())).status).toBe(404)
    expect((await retry('nope')).status).toBe(404)
  })

  it('transcribes a transcribed page again for its assigned engineer, replacing the text (CP-20)', async () => {
    handwriting.mockReturnValue(s5(200, read('FHR 7 bor', [[4, 9]])))
    await assessmentWithSession()
    const { id } = (await savePages([{ image: JPG }])).body
    const [page] = (await pagesSettled(id)).pages!
    const again = () => api.post(`/api/observations/${id}/pages/${page._id}/retranscribe`)

    handwriting.mockReturnValue(s5(200, read('FHR 7 bar')))
    const response = await again()

    // The old text goes as the new attempt starts, so it reads as a new transcription.
    expect(response.status).toBe(200)
    expect(response.body.pages[0].transcription).toMatchObject({
      status: 'transcribing',
      transcript: null,
      uncertain: [],
      attempts: 2,
    })
    expect(response.body.edited).toMatchObject({ by: { name: 'Alex Rowe' } })
    await pagesSettled(id)
    const [o] = await listed()
    expect(o.pages[0].transcription).toMatchObject({
      status: 'transcribed',
      transcript: 'FHR 7 bar',
      uncertain: [],
      attempts: 2,
    })
    expect(handwriting).toHaveBeenCalledTimes(2)
    expect(handwriting).toHaveBeenLastCalledWith({ s3_key: page.key })
  })

  it('transcribes again only a transcribed page, and only for the assigned engineer (CP-20)', async () => {
    handwriting.mockImplementation(({ s3_key }) =>
      s3_key.endsWith('.png')
        ? s5(502, { detail: 'The page could not be transcribed: timeout.' })
        : s5(200, read('x')),
    )
    await assessmentWithSession()
    const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body
    const [done, failed] = (await pagesSettled(id)).pages!
    const again = (pageId: unknown, as = api) =>
      as.post(`/api/observations/${id}/pages/${pageId}/retranscribe`)

    const refused = await again(failed._id)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('This page’s transcription failed. Retry it instead.')
    expect((await again(new Types.ObjectId())).status).toBe(404)
    const otherEngineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')
    expect((await again(done._id, otherEngineer)).status).toBe(403)
    expect(handwriting).toHaveBeenCalledTimes(2)

    // Asked twice at once, one attempt starts.
    handwriting.mockReturnValue(new Promise<Response>(() => {}))
    const replies = await Promise.all([again(done._id), again(done._id)])
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409])
    // The attempt reaches S5 after the reply.
    await vi.waitFor(() => expect(handwriting).toHaveBeenCalledTimes(3))
  })

  it('says why the provider refused: a used-up limit, a busy service or a slow answer', async () => {
    const reasons = {
      'limit.jpg':
        "The page could not be transcribed: Error code: 429 - {'error': {'message': 'Rate limit exceeded for model gemini-3.8-flash (limit: 20 requests per day on Free Tier).'}}",
      'busy.jpg':
        "The page could not be transcribed: Error code: 503 - {'error': {'message': 'gemini-3.8-flash is currently experiencing high demand.'}}",
      'slow.jpg': 'The page could not be transcribed: The read operation timed out',
    }
    handwriting.mockImplementation(async ({ s3_key }) => {
      const page = (await ObservationModel.findOne({ 'pages.key': s3_key }).lean())!.pages!.find(
        (p) => p.key === s3_key,
      )!
      return s5(502, { detail: reasons[page.name as keyof typeof reasons] })
    })
    await assessmentWithSession()

    await pagesSettled(
      (
        await savePages([
          { image: JPG, name: 'limit.jpg' },
          { image: JPG, name: 'busy.jpg' },
          { image: JPG, name: 'slow.jpg' },
        ])
      ).body.id,
    )

    const [o] = await listed()
    expect(o.pages.map((p: { transcription: { error: string } }) => p.transcription.error)).toEqual(
      [
        'The handwriting service has reached its usage limit. Try again later.',
        'The handwriting service is busy. Try again in a minute.',
        'The handwriting service took too long to answer.',
      ],
    )
  })

  it('says the service took too long when the gateway gives up waiting', async () => {
    handwriting.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'UND_ERR_HEADERS_TIMEOUT' },
      }),
    )
    await assessmentWithSession()

    await pagesSettled((await savePages([{ image: JPG }])).body.id)

    expect((await listed())[0].pages[0].transcription.error).toBe(
      'The handwriting service took too long to answer.',
    )
  })

  it('says so when the handwriting service cannot be reached', async () => {
    handwriting.mockRejectedValue(new TypeError('fetch failed'))
    await assessmentWithSession()

    await pagesSettled((await savePages([{ image: JPG }])).body.id)

    expect((await listed())[0].pages[0].transcription.error).toBe(
      'The handwriting service could not be reached.',
    )
  })

  it('marks pages interrupted by a restart as failed so they can be retried (AC11)', async () => {
    handwriting.mockReturnValue(new Promise<Response>(() => {}))
    await assessmentWithSession()
    const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body

    await resumeInterruptedTranscriptions()

    const stored = await ObservationModel.findById(id).lean()
    for (const p of stored!.pages!) {
      expect(p.transcription.status).toBe('failed')
      expect(p.transcription.error).toMatch(/interrupted by a gateway restart/)
    }
  })

  it('streams the original page back', async () => {
    handwriting.mockReturnValue(s5(200, read('x')))
    await assessmentWithSession()
    const { id, pages } = (await savePages([{ image: PNG }])).body
    await pagesSettled(id)

    const response = await api.get(pages[0].url).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toContain('immutable')
    expect(Buffer.from(response.body)).toEqual(PNG)
    expect((await api.get(`/api/observations/${id}/pages/nope/image`)).status).toBe(404)
    const unknown = `/api/observations/${id}/pages/${new Types.ObjectId()}/image`
    expect((await api.get(unknown)).status).toBe(404)
  })

  it('is not a site photo: read as its text, and not offered for the appendix (AC5, CP-21)', async () => {
    handwriting.mockReturnValue(s5(200, read('Riser door wedged open')))
    await assessmentWithSession()
    const { id, pages } = (await savePages([{ image: JPG }])).body
    await pagesSettled(id)

    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(202)
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
    expect(vision).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: [],
        texts: [{ label: pages[0].name, kind: 'page', text: 'Riser door wedged open' }],
      }),
    )
    const appendix = await api.get('/api/assessments/RPT-2026-0411/appendix')
    expect(appendix.body.available).toEqual([])
  })

  it('counts as something captured, so the note or a photo can go while a page stays', async () => {
    handwriting.mockReturnValue(s5(200, read('x')))
    await assessmentWithSession()
    const req = savePages([{ image: JPG }], { note: 'Riser room.' })
    req.attach('photo', PNG, { filename: 'riser.png', contentType: 'image/png' })
    const { id, photos } = (await req).body
    await pagesSettled(id)

    expect((await api.patch(`/api/observations/${id}`).send({ note: null })).status).toBe(200)
    expect((await api.delete(`/api/observations/${id}/photos/${photos[0].id}`)).status).toBe(200)
    const [o] = await listed()
    expect(o).toMatchObject({ note: null, photos: [], pages: [{ type: 'Scan' }] })
  })

  describe('managing saved pages (CP-20)', () => {
    const by = { id: String(actor._id), name: 'Alex Rowe' }
    const addPages = (id: unknown, images: Buffer[], as = api) => {
      const req = as.post(`/api/observations/${id}/media`)
      images.forEach((image, i) =>
        req.attach('page', image, {
          filename: `IMG_08${10 + i}.${image === PNG ? 'png' : 'jpg'}`,
          contentType: image === PNG ? 'image/png' : 'image/jpeg',
        }),
      )
      return req
    }
    const correctPage = (id: unknown, pageId: unknown, text: unknown, as = api) =>
      as.put(`/api/observations/${id}/pages/${pageId}/transcript`).send({ text })
    const removePage = (id: unknown, pageId: unknown, as = api) =>
      as.delete(`/api/observations/${id}/pages/${pageId}`)
    const restorePage = (id: unknown, pageId: unknown, as = api) =>
      as.post(`/api/observations/${id}/pages/${pageId}/restore`)
    // The texts the observation's reading was given, the last time it was read.
    const lastRead = (texts: object[]) =>
      expect(vision).toHaveBeenLastCalledWith(expect.objectContaining({ texts }))

    it('adds pages to a saved observation, each stored, marked as added and transcribed', async () => {
      // A fresh answer per page: a response body can be read only once.
      handwriting.mockImplementation(() => s5(200, read('Sprinkler valve shut')))
      await assessmentWithSession()
      const { id } = (await note()).body

      const response = await addPages(id, [JPG, PNG])

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        pages: [
          { name: 'IMG_0810.jpg', added: { by }, transcription: { status: 'transcribing' } },
          { name: 'IMG_0811.png', added: { by }, transcription: { status: 'transcribing' } },
        ],
        removedPages: [],
        edited: { by },
      })
      const stored = await pagesSettled(id)
      const [first, second] = stored.pages!
      expect(first.key).toBe(`pages/RPT-2026-0411/${id}/${first._id}.jpg`)
      expect(second.key).toBe(`pages/RPT-2026-0411/${id}/${second._id}.png`)
      expect(s3.get(first.key)).toEqual(JPG)
      expect(s3.get(second.key)).toEqual(PNG)
      // Each page added is transcribed on its own, as at capture.
      expect(handwriting).toHaveBeenCalledTimes(2)
      const [o] = await listed()
      expect(o.pages.map((p: { transcription: object }) => p.transcription)).toEqual([
        expect.objectContaining({ status: 'transcribed', transcript: 'Sprinkler valve shut' }),
        expect.objectContaining({ status: 'transcribed', transcript: 'Sprinkler valve shut' }),
      ])
    })

    it('refuses a page capture would refuse, adding nothing', async () => {
      await assessmentWithSession()
      const { id } = (await note()).body

      const heic = await api
        .post(`/api/observations/${id}/media`)
        .attach('page', JPG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .attach('page', HEIC, { filename: 'b.jpg', contentType: 'image/jpeg' })
      expect(heic.status).toBe(415)
      expect(s3.size).toBe(0)
      const [o] = await listed()
      expect(o).toMatchObject({ pages: [], edited: null })
      expect(handwriting).not.toHaveBeenCalled()
    })

    it("corrects a page's text, keeping the model's, and reading uses the correction", async () => {
      handwriting.mockReturnValue(s5(200, read('Sprinkler valve sht', [[16, 19]])))
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }])).body
      const [page] = (await pagesSettled(id)).pages!

      const response = await correctPage(id, page._id, 'Sprinkler valve shut')

      expect(response.status).toBe(200)
      expect(response.body.pages[0].transcription).toMatchObject({
        // The model's words, and what it was unsure of, stay as evidence.
        transcript: 'Sprinkler valve sht',
        uncertain: [[16, 19]],
        correction: { text: 'Sprinkler valve shut', by },
      })
      expect(response.body.edited).toMatchObject({ by })

      expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(202)
      await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
      lastRead([{ label: page.name, kind: 'page', text: 'Sprinkler valve shut' }])

      // Writing the model's words back removes the correction.
      const back = await correctPage(id, page._id, 'Sprinkler valve sht')
      expect(back.body.pages[0].transcription.correction).toBeNull()
    })

    it('corrects only a finished page, with text, for the assigned engineer', async () => {
      handwriting.mockImplementation(({ s3_key }) =>
        s3_key.endsWith('.png')
          ? s5(502, { detail: 'The page could not be transcribed: timeout.' })
          : s5(200, read('')),
      )
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body
      const [empty, failed] = (await pagesSettled(id)).pages!

      const blank = await correctPage(id, empty._id, '   ')
      expect(blank.status).toBe(400)
      expect(blank.body.fields.text).toBe('Write the corrected transcript.')
      const notDone = await correctPage(id, failed._id, 'x')
      expect(notDone.status).toBe(409)
      expect(notDone.body.error).toBe('Only a finished transcription can be corrected.')
      expect((await correctPage(id, new Types.ObjectId(), 'x')).status).toBe(404)
      const otherEngineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')
      expect((await correctPage(id, empty._id, 'x', otherEngineer)).status).toBe(403)

      // A page the model found no handwriting on can still be written by hand.
      const written = await correctPage(id, empty._id, 'Hydrant H2 blocked')
      expect(written.status).toBe(200)
      expect(written.body.pages[0].transcription).toMatchObject({
        transcript: '',
        correction: { text: 'Hydrant H2 blocked' },
      })
    })

    it('drops the correction when the page is transcribed again', async () => {
      handwriting.mockReturnValue(s5(200, read('FHR 7 bor')))
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }])).body
      const [page] = (await pagesSettled(id)).pages!
      await correctPage(id, page._id, 'FHR 7 bar')

      handwriting.mockReturnValue(s5(200, read('FHR 7 bar.')))
      const again = await api.post(`/api/observations/${id}/pages/${page._id}/retranscribe`)

      expect(again.status).toBe(200)
      expect(again.body.pages[0].transcription).toMatchObject({
        status: 'transcribing',
        transcript: null,
        correction: null,
      })
      await pagesSettled(id)
      const [o] = await listed()
      expect(o.pages[0].transcription).toMatchObject({
        transcript: 'FHR 7 bar.',
        correction: null,
      })
    })

    it('removes a page, leaving it out of reading, and restores it', async () => {
      handwriting.mockImplementation(({ s3_key }) =>
        s5(200, read(s3_key.endsWith('.png') ? 'Second page' : 'First page')),
      )
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body
      const [first, second] = (await pagesSettled(id)).pages!

      const removed = await removePage(id, second._id)

      expect(removed.status).toBe(200)
      expect(removed.body).toMatchObject({
        pages: [{ id: String(first._id) }],
        removedPages: [{ id: String(second._id), removed: { by } }],
        edited: { by },
      })
      // Kept, file and all: a soft removal.
      expect(s3.get(second.key)).toEqual(PNG)
      expect((await removePage(id, second._id)).body.error).toBe('This page is already removed.')

      // A removed page is not read, corrected or transcribed again until restored.
      expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(202)
      await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
      lastRead([{ label: first.name, kind: 'page', text: 'First page' }])
      const correcting = await correctPage(id, second._id, 'x')
      expect(correcting.status).toBe(409)
      expect(correcting.body.error).toBe(
        'This page is removed. Restore it before correcting its text.',
      )
      const again = await api.post(`/api/observations/${id}/pages/${second._id}/retranscribe`)
      expect(again.status).toBe(409)
      expect(again.body.error).toBe(
        'This page is removed. Restore it before transcribing it again.',
      )

      const restored = await restorePage(id, second._id)
      expect(restored.status).toBe(200)
      expect(restored.body).toMatchObject({
        pages: [{ id: String(first._id) }, { id: String(second._id) }],
        removedPages: [],
      })
      expect((await restorePage(id, second._id)).body.error).toBe('This page is not removed.')
    })

    it('does not retry a removed page until it is restored', async () => {
      handwriting.mockReturnValue(
        s5(502, { detail: 'The page could not be transcribed: timeout.' }),
      )
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }], { note: 'Riser room.' })).body
      const [page] = (await pagesSettled(id)).pages!
      await removePage(id, page._id)

      const retry = await api.post(`/api/observations/${id}/pages/${page._id}/transcription/retry`)

      expect(retry.status).toBe(409)
      expect(retry.body.error).toBe('This page is removed. Restore it before retrying it.')
      expect(handwriting).toHaveBeenCalledTimes(1)
    })

    it('keeps something captured: the last page, or the note once pages are removed', async () => {
      handwriting.mockImplementation(() => s5(200, read('x')))
      await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }, { image: PNG }])).body
      const [first, second] = (await pagesSettled(id)).pages!

      expect((await removePage(id, first._id)).status).toBe(200)
      const last = await removePage(id, second._id)
      expect(last.status).toBe(409)
      expect(last.body.error).toBe(
        'An observation needs a note, a recording, a photo or a page, so this page can’t be removed. Add what replaces it first.',
      )

      // With a note, the last page can go; then the note can't, as the
      // removed pages no longer count as captured.
      expect((await api.patch(`/api/observations/${id}`).send({ note: 'Riser.' })).status).toBe(200)
      expect((await removePage(id, second._id)).status).toBe(200)
      const noNote = await api.patch(`/api/observations/${id}`).send({ note: null })
      expect(noNote.status).toBe(400)
    })

    it('lets only the assigned engineer change pages, and not once deleted or archived', async () => {
      handwriting.mockReturnValue(s5(200, read('x')))
      const assessment = await assessmentWithSession()
      const { id } = (await savePages([{ image: JPG }], { note: 'Riser room.' })).body
      const [page] = (await pagesSettled(id)).pages!

      const otherEngineer = signedInAsRole(app, 'risk_engineer', 'Jide Okafor')
      const admin = signedInAsRole(app, 'knowledge_admin', 'Sana Patel')
      for (const as of [otherEngineer, admin]) {
        expect((await addPages(id, [JPG], as)).status).toBe(403)
        expect((await removePage(id, page._id, as)).status).toBe(403)
        expect((await correctPage(id, page._id, 'y', as)).status).toBe(403)
      }

      expect((await api.delete(`/api/observations/${id}`)).status).toBe(200)
      expect((await addPages(id, [JPG])).status).toBe(409)
      expect((await removePage(id, page._id)).status).toBe(409)
      expect((await correctPage(id, page._id, 'y')).status).toBe(409)
      expect((await api.post(`/api/observations/${id}/restore`)).status).toBe(200)

      await AssessmentModel.updateOne({ _id: assessment._id }, { archivedAt: new Date() })
      expect((await addPages(id, [JPG])).status).toBe(409)
      expect((await removePage(id, page._id)).status).toBe(409)
      expect((await correctPage(id, page._id, 'y')).status).toBe(409)
      expect(s3.size).toBe(1)
    })
  })

  it('lists an observation saved before pages existed with none', async () => {
    const assessment = await assessmentWithSession()
    const session = await CaptureSessionModel.findOne({ assessment: assessment._id }).lean()
    // Written without Mongoose, which would add an empty list.
    await ObservationModel.collection.insertOne({
      assessment: assessment._id,
      session: session!._id,
      engineer: 'Alex Rowe',
      note: 'Before pages.',
      recordings: [],
      severity: 'low',
      location: BAY_3,
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: ['Protection'],
        effective_date: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const [o] = await listed()

    expect(o.pages).toEqual([])
  })
})
