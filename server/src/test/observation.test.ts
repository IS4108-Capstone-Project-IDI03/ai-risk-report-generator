import { Types } from 'mongoose'
import { Readable } from 'stream'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import {
  failInterruptedTranscriptions,
  listCategoryObservations,
} from '../services/observation.service'
import { useMemoryMongo } from './memory-mongo'

// S3 stands in as a map; S5 as a stubbed fetch.
const s3 = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  getObjectStream: async (key: string) => Readable.from([s3.get(key)]),
  deleteObject: async (key: string) => void s3.delete(key),
}))
const speech = vi.fn<(body: { s3_key: string }) => Promise<Response>>()

useMemoryMongo()

beforeEach(() => {
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => speech(JSON.parse(String(init.body))))
})
afterEach(() => {
  s3.clear()
  speech.mockReset()
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
  const req = request(app)
    .post(`/api/assessments/${reference}/observations`)
    .field(
      'details',
      JSON.stringify({
        engineer: 'A. Rowe',
        copeDimension: 'Protection',
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
    expect(stored?.engineer).toBe('A. Rowe')
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
      COPE_dimension: 'Protection',
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
    const uncategorised = (await note({ copeDimension: null })).body
    const exposure = (await note({ copeDimension: 'Exposure' })).body

    // The field is present but null, so it is never mistaken for a category.
    const stored = await ObservationModel.findById(uncategorised.id).lean()
    expect(stored?.metadata).toHaveProperty('COPE_dimension', null)
    expect(uncategorised.copeDimension).toBeNull()
    for (const dimension of ['Construction', 'Occupancy', 'Protection', 'Exposure'] as const) {
      const inputs = await listCategoryObservations('RPT-2026-0411', dimension)
      expect(inputs.map((o) => o.id)).not.toContain(uncategorised.id)
    }
    const exposureInputs = await listCategoryObservations('RPT-2026-0411', 'Exposure')
    expect(exposureInputs.map((o) => o.id)).toEqual([exposure.id])
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
    expect((await request(app).post('/api/assessments/RPT-2026-0411/observations')).status).toBe(
      400,
    )
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('names each invalid field', async () => {
    await assessmentWithSession()

    const invalid = [
      [{ note: 'x'.repeat(5001) }, 'note'],
      [{ engineer: ' ' }, 'engineer'],
      [{ copeDimension: 'Fire protection' }, 'copeDimension'],
      [{ copeDimension: undefined }, 'copeDimension'],
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
    request(app).post(`/api/observations/${id}/recordings/${recordingId}/transcription/retry`)

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

describe('observation list, audio and restarts', () => {
  it('lists the observations newest first, with each recording and its transcription', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Racking is new.' }))
    await assessmentWithSession()
    const first = (await save()).body
    await settled(first.id)
    const second = (await note({ copeDimension: null })).body

    const response = await request(app).get('/api/assessments/RPT-2026-0411/observations')

    expect(response.status).toBe(200)
    expect(response.body.map((o: { id: string }) => o.id)).toEqual([second.id, first.id])
    expect(response.body[1]).toMatchObject({
      engineer: 'A. Rowe',
      copeDimension: 'Protection',
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

    const response = await request(app).get(recordings[0].url).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('audio/webm')
    expect(Buffer.from(response.body)).toEqual(AUDIO)
    expect((await request(app).get(`/api/observations/${id}/recordings/nope/audio`)).status).toBe(
      404,
    )
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
