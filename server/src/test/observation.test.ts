import { Readable } from 'stream'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { failInterruptedTranscriptions } from '../services/observation.service'
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
  })
  await CaptureSessionModel.create({ assessment: assessment._id, status })
  return assessment
}

function upload(reference = 'RPT-2026-0411', body = AUDIO, type = 'audio/webm;codecs=opus') {
  return request(app)
    .post(`/api/assessments/${reference}/observations/voice`)
    .set('Content-Type', type)
    .set('X-Engineer', 'A. Rowe')
    .set('X-COPE-Dimension', 'Protection')
    .set('X-Severity', 'high')
    .send(body)
}

// The transcription runs after the response, so wait for it to settle.
async function settled(id: string) {
  await vi.waitFor(async () => {
    const o = await ObservationModel.findById(id).lean()
    expect(o?.transcription.status).not.toBe('transcribing')
  })
  return (await ObservationModel.findById(id).lean())!
}

describe('POST /api/assessments/:reference/observations/voice', () => {
  it('stores the audio in S3 and records it as a voice observation by the engineer', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Sprinkler valve chained open.' }))
    const assessment = await assessmentWithSession()

    const response = await upload()

    expect(response.status).toBe(201)
    const stored = await ObservationModel.findById(response.body.id).lean()
    expect(stored?.type).toBe('voice')
    expect(stored?.engineer).toBe('A. Rowe')
    expect(stored?.severity).toBe('high')
    expect(stored?.audio.key).toBe(`audio/RPT-2026-0411/${response.body.id}.webm`)
    expect(s3.get(stored!.audio.key)).toEqual(AUDIO)
    expect(stored?.metadata).toMatchObject({
      source_type: 'voice',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Protection',
    })
    // Saving adds to the session without ending it.
    const session = await CaptureSessionModel.findOne({ assessment: assessment._id }).lean()
    expect(session?.status).toBe('active')
  })

  it('queues exactly one transcription and stores the transcript', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Sprinkler valve chained open.' }))
    await assessmentWithSession()

    const response = await upload()

    expect(response.body.transcription).toMatchObject({ status: 'transcribing', attempts: 1 })
    const done = await settled(response.body.id)
    expect(done.transcription.status).toBe('transcribed')
    expect(done.transcription.transcript).toBe('Sprinkler valve chained open.')
    expect(done.transcription.attempts).toHaveLength(1)
    expect(speech).toHaveBeenCalledTimes(1)
    expect(speech).toHaveBeenCalledWith({ s3_key: done.audio.key })
  })

  it('records the reason when transcription fails', async () => {
    speech.mockReturnValue(s5(502, { detail: 'Whisper rejected the audio: file is too short.' }))
    await assessmentWithSession()

    const response = await upload()

    const done = await settled(response.body.id)
    expect(done.transcription.status).toBe('failed')
    expect(done.transcription.error).toBe('Whisper rejected the audio: file is too short.')
    expect(done.transcription.attempts[0].finishedAt).toBeInstanceOf(Date)
  })

  it('says so when the speech service cannot be reached', async () => {
    speech.mockRejectedValue(new TypeError('fetch failed'))
    await assessmentWithSession()

    const done = await settled((await upload()).body.id)

    expect(done.transcription.error).toBe('The speech service could not be reached.')
  })

  it('records the standard and location the engineer picked, or none', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'x' }))
    await assessmentWithSession()

    const withStandard = await request(app)
      .post('/api/assessments/RPT-2026-0411/observations/voice')
      .query({ standard: 'NFPA 25 – 2026 Edition', area: 'Bay 3 — north aisle' })
      .set('Content-Type', 'audio/webm')
      .set('X-Engineer', 'A. Rowe')
      .set('X-COPE-Dimension', 'Protection')
      .set('X-Severity', 'high')
      .send(AUDIO)
    const without = await upload()

    expect(withStandard.body).toMatchObject({
      standard: 'NFPA 25 – 2026 Edition',
      area: 'Bay 3 — north aisle',
      severity: 'high',
    })
    expect(without.body).toMatchObject({ standard: null, area: null })
    await settled(withStandard.body.id)
    await settled(without.body.id)
  })

  it('rejects a recording when no capture session is in progress', async () => {
    await assessmentWithSession('RPT-2026-0411', 'ready_for_generation')

    const response = await upload()

    expect(response.status).toBe(409)
    expect(s3.size).toBe(0)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('rejects unknown assessments, unsupported formats and empty recordings', async () => {
    await assessmentWithSession()

    expect((await upload('RPT-2026-9999')).status).toBe(404)
    expect((await upload('RPT-2026-0411', AUDIO, 'audio/aac')).status).toBe(415)
    expect((await upload('RPT-2026-0411', Buffer.alloc(0))).status).toBe(400)
    const noCategory = await request(app)
      .post('/api/assessments/RPT-2026-0411/observations/voice')
      .set('Content-Type', 'audio/webm')
      .set('X-Engineer', 'A. Rowe')
      .set('X-COPE-Dimension', 'Fire protection')
      .set('X-Severity', 'high')
      .send(AUDIO)
    expect(noCategory.status).toBe(400)
    const noSeverity = await request(app)
      .post('/api/assessments/RPT-2026-0411/observations/voice')
      .set('Content-Type', 'audio/webm')
      .set('X-Engineer', 'A. Rowe')
      .set('X-COPE-Dimension', 'Protection')
      .set('X-Severity', 'urgent')
      .send(AUDIO)
    expect(noSeverity.status).toBe(400)
  })
})

describe('POST /api/observations/:id/transcription/retry', () => {
  it('starts a new attempt for the same recording', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await upload()).body.id)
    speech.mockReturnValueOnce(s5(200, { transcript: 'Second time lucky.' }))

    const response = await request(app).post(`/api/observations/${failed._id}/transcription/retry`)

    expect(response.status).toBe(202)
    const done = await settled(String(failed._id))
    expect(done.transcription.status).toBe('transcribed')
    expect(done.transcription.transcript).toBe('Second time lucky.')
    expect(done.transcription.error).toBeUndefined()
    expect(done.transcription.attempts).toHaveLength(2)
    expect(speech).toHaveBeenLastCalledWith({ s3_key: failed.audio.key })
  })

  it('starts only one attempt when retry is sent twice at once', async () => {
    speech.mockReturnValueOnce(s5(502, { detail: 'Whisper timed out.' }))
    await assessmentWithSession()
    const failed = await settled((await upload()).body.id)
    speech.mockReturnValue(s5(200, { transcript: 'Done.' }))

    const statuses = (
      await Promise.all(
        [1, 2].map(() => request(app).post(`/api/observations/${failed._id}/transcription/retry`)),
      )
    ).map((r) => r.status)

    expect(statuses.sort()).toEqual([202, 409])
    expect((await settled(String(failed._id))).transcription.attempts).toHaveLength(2)
  })

  it('returns 404 for an unknown observation', async () => {
    const response = await request(app).post('/api/observations/nope/transcription/retry')
    expect(response.status).toBe(404)
  })
})

describe('observation list, audio and restarts', () => {
  it('lists the assessment observations with their transcription status', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'Racking is new.' }))
    await assessmentWithSession()
    const { id } = (await upload()).body
    await settled(id)

    const response = await request(app).get('/api/assessments/RPT-2026-0411/observations')

    expect(response.status).toBe(200)
    expect(response.body).toEqual([
      expect.objectContaining({
        id,
        engineer: 'A. Rowe',
        copeDimension: 'Protection',
        audio: expect.objectContaining({ url: `/api/observations/${id}/audio` }),
        transcription: {
          status: 'transcribed',
          transcript: 'Racking is new.',
          error: null,
          attempts: 1,
        },
      }),
    ])
  })

  it('streams the original recording back', async () => {
    speech.mockReturnValue(s5(200, { transcript: 'x' }))
    await assessmentWithSession()
    const { id } = (await upload()).body

    const response = await request(app).get(`/api/observations/${id}/audio`).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('audio/webm')
    expect(Buffer.from(response.body)).toEqual(AUDIO)
    await settled(id)
  })

  it('marks transcriptions interrupted by a restart as failed so they can be retried', async () => {
    speech.mockReturnValue(new Promise<Response>(() => {}))
    await assessmentWithSession()
    const { id } = (await upload()).body

    await failInterruptedTranscriptions()

    const stored = await ObservationModel.findById(id).lean()
    expect(stored?.transcription.status).toBe('failed')
    expect(stored?.transcription.error).toMatch(/interrupted by a gateway restart/)
  })
})
