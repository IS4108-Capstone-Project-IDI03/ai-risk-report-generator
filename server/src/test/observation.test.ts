import { Types } from 'mongoose'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import {
  failInterruptedInterpretations,
  failInterruptedTranscriptions,
  listCategoryObservations,
} from '../services/observation.service'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

// S3 stands in as a map; S5 as a stubbed fetch.
const s3 = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  getObjectStream: async (key: string) => Readable.from([s3.get(key)]),
  deleteObject: async (key: string) => void s3.delete(key),
}))
const speech = vi.fn<(body: { s3_key: string }) => Promise<Response>>()
// S5's photo interpretation (CP-05), stubbed apart from transcription.
type InterpretBody = { s3_keys: string[]; location: string | null; note: string | null }
const vision = vi.fn<(body: InterpretBody) => Promise<Response>>()

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
    return url.endsWith('/interpret') ? vision(body) : speech(body)
  })
})
afterEach(() => {
  s3.clear()
  speech.mockReset()
  vision.mockReset()
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
      location: { id: String(PUMP_HOUSE), name: 'Pump house', floor: null },
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

  it('marks transcriptions interrupted by a restart as failed so they can be retried', async () => {
    speech.mockReturnValue(new Promise<Response>(() => {}))
    await assessmentWithSession()
    const { id } = (await save({}, [{}, {}])).body

    await failInterruptedTranscriptions()

    const stored = await ObservationModel.findById(id).lean()
    for (const r of stored!.recordings) {
      expect(r.transcription.status).toBe('failed')
      expect(r.transcription.error).toMatch(/interrupted by a gateway restart/)
    }
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

describe('photo interpretation (CP-05)', () => {
  const PROPOSAL = {
    description:
      'During the site visit to Bay 3, it was observed that the new racking sits under two sprinkler heads.',
    cope_dimension: 'Protection',
    hazard_type: 'Sprinkler Installation',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'cp05-v1',
    usage: { input_tokens: 2064, output_tokens: 48, thought_tokens: 180 },
  }
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
  // Saves photos, then asks for them to be read, as the Observations tab does.
  async function readSaved(photos: Photo[] = [{ image: JPG }], fields: object = {}) {
    const { id } = (await savePhotos(photos, fields)).body
    expect((await read(id)).status).toBe(202)
    return id as string
  }

  it('sends no photo to the vision model when it is saved', async () => {
    await assessmentWithSession()

    const response = await savePhotos([{ image: JPG }, { image: PNG }])

    expect(response.status).toBe(201)
    expect(response.body.interpretation).toBeNull()
    const stored = await ObservationModel.findById(response.body.id).lean()
    expect(stored?.interpretation).toBeUndefined()
    expect(vision).not.toHaveBeenCalled()
  })

  it('reads all the photos, with the location and note, when asked (AC1, AC2)', async () => {
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
      s3_keys: stored!.photos!.map((p) => p.key),
      location: 'Bay 3 — north aisle · Ground',
      note: 'Racking under the heads.',
    })
    expect(speech).not.toHaveBeenCalled()
    // Listed as interpreting while it runs (AC2), naming the photos it reads.
    expect((await listed())[0].interpretation).toEqual({
      status: 'interpreting',
      description: null,
      copeDimension: null,
      hazardType: null,
      error: null,
      attempts: 1,
      model: null,
      photoIds: stored!.photos!.map((p) => String(p._id)),
      outOfDate: false,
    })
    finish(await s5(200, PROPOSAL))
    await interpreted(id)
  })

  it('stores the proposal and what wrote it, leaving the engineer’s own record alone (AC3-AC5)', async () => {
    vision.mockReturnValue(s5(200, PROPOSAL))
    await assessmentWithSession()
    const id = await readSaved([{ image: JPG }], { copeDimensions: null })

    const done = await interpreted(id)

    expect(done.interpretation).toMatchObject({
      status: 'interpreted',
      description: PROPOSAL.description,
      copeDimension: 'Protection',
      hazardType: 'Sprinkler Installation',
      provenance: {
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        promptVersion: 'cp05-v1',
        usage: { inputTokens: 2064, outputTokens: 48, thoughtTokens: 180 },
      },
    })
    expect(done.interpretation!.attempts[0].finishedAt).toBeInstanceOf(Date)
    const [observation] = await listed()
    expect(observation.interpretation).toEqual({
      status: 'interpreted',
      description: PROPOSAL.description,
      copeDimension: 'Protection',
      hazardType: 'Sprinkler Installation',
      error: null,
      attempts: 1,
      model: 'gemini-3.8-flash',
      photoIds: [observation.photos[0].id],
      outOfDate: false,
    })
    // A proposal only: the observation stays uncategorised, with no note.
    expect(observation).toMatchObject({ copeDimensions: null, note: null })
  })

  it('records usage as unavailable when the provider reports none', async () => {
    vision.mockReturnValue(s5(200, { ...PROPOSAL, usage: null }))
    await assessmentWithSession()

    const done = await interpreted(await readSaved())

    expect(done.interpretation?.provenance?.usage).toBeNull()
  })

  it('shows why it failed, and reads again only after a failure', async () => {
    vision.mockReturnValue(
      s5(502, { detail: 'The photos could not be interpreted: 403 API key not valid.' }),
    )
    await assessmentWithSession()
    const id = await readSaved()

    const failed = await interpreted(id)

    // The detail is kept with the attempt; the engineer sees a readable reason.
    expect(failed.interpretation).toMatchObject({
      status: 'failed',
      error: 'The photos could not be interpreted: 403 API key not valid.',
    })
    expect((await listed())[0].interpretation.error).toBe(
      'The photo service could not interpret the photos.',
    )

    vision.mockReturnValue(s5(200, PROPOSAL))
    expect((await read(id)).status).toBe(202)
    const done = await interpreted(id)
    expect(done.interpretation?.status).toBe('interpreted')
    expect(done.interpretation?.attempts).toHaveLength(2)
    expect(done.interpretation?.error).toBeUndefined()

    const again = await read(id)
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('Its photos have already been read.')
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

  it('refuses to read an observation with no photos, a deleted one or an unknown one', async () => {
    await assessmentWithSession()
    const { id: noted } = (await note()).body
    const noPhotos = await read(noted)
    expect(noPhotos.status).toBe(409)
    expect(noPhotos.body.error).toBe('This observation has no photos to read.')

    const { id } = (await savePhotos([{ image: JPG }])).body
    await api.delete(`/api/observations/${id}`)
    expect((await read(id)).status).toBe(409)

    expect((await read(String(new Types.ObjectId()))).status).toBe(404)
    expect((await read('nope')).status).toBe(404)
    expect(vision).not.toHaveBeenCalled()
  })

  it('says so when the photo service cannot be reached', async () => {
    vision.mockRejectedValue(new TypeError('fetch failed'))
    await assessmentWithSession()

    const done = await interpreted(await readSaved())

    expect(done.interpretation?.error).toBe('The photo service could not be reached.')
  })

  it('marks interpretations interrupted by a restart as failed so they can be read again', async () => {
    await assessmentWithSession()
    const id = await readSaved()

    await failInterruptedInterpretations()

    expect((await ObservationModel.findById(id).lean())?.interpretation).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/interrupted by a gateway restart/),
    })
  })

  it('leaves an observation without photos uninterpreted', async () => {
    await assessmentWithSession()

    const response = await note()

    expect(response.body.interpretation).toBeNull()
    expect(vision).not.toHaveBeenCalled()
    const stored = await ObservationModel.findById(response.body.id).lean()
    expect(stored?.interpretation).toBeUndefined()
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
    description: 'During the site visit to Bay 3, it was observed that racking stood under a head.',
    cope_dimension: 'Protection',
    hazard_type: 'Sprinkler Installation',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'cp05-v1',
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
    expect(nothing.body.error).toBe('Add a recording or a photo to the observation.')

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
      'An observation needs a note, a recording or a photo, so this photo can’t be removed. Add what replaces it first.',
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
      expect.objectContaining({ s3_keys: [stored!.photos![1].key] }),
    )
    await vi.waitFor(async () =>
      expect(await reading()).toMatchObject({
        status: 'interpreted',
        photoIds: [second],
        outOfDate: false,
        attempts: 2,
      }),
    )
    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(409)
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

    // With every photo removed there is no reading to show, or to ask for.
    await remove(id, 'photos', added.photos[1].id)
    const none = (await remove(id, 'photos', photos[0].id)).body
    expect(none.interpretation).toBeNull()
    expect(none.removedPhotos).toHaveLength(2)
    expect((await api.post(`/api/observations/${id}/interpretation`)).status).toBe(409)
  })
})

it('uses each authenticated capturer ID and ignores forged attribution, while deriving text metadata', async () => {
  await assessmentWithSession()
  const another = { ...actor, _id: new Types.ObjectId(), name: 'Jide Okafor' }
  for (const user of [actor, another]) {
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
