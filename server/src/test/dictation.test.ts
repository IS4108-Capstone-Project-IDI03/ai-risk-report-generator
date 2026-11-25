import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { UserModel, type UserRole } from '../models/user.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

// Dictating into a text field of an assessment (CP-27): the clip goes straight to S5 as bytes,
// comes back tidied, and is stored nowhere. S5 is a stubbed fetch, so no paid call is made.
useMemoryMongo()

// MarshBot's re-check queue (AS-06), watched: dictating changes nothing it checks.
const queued = vi.hoisted(() => [] as string[])
vi.mock('../services/assistant/check-queue.service', async (original) => ({
  ...(await original<object>()),
  queueAssessmentCheck: (reference: string) => void queued.push(reference),
}))

const person = (name: string, staffId: string, role: UserRole = 'risk_engineer') => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const engineer = person('Alex Rowe', 'TEST-1')
// A risk engineer the assessment is not assigned to: they cannot open it.
const colleague = person('Jide Okafor', 'TEST-3')
const asEngineer = signedInAs(app, engineer)

const REFERENCE = 'RPT-2026-0411'
const DICTATE = `/api/assessments/${REFERENCE}/dictation`

let s5: { url: string; body: Record<string, unknown> }[]
const s5Says = (reply: object, status = 200) =>
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    s5.push({ url, body: JSON.parse(init.body) })
    return Response.json(reply, { status })
  })

beforeEach(async () => {
  s5 = []
  await UserModel.create([engineer, colleague])
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'First survey',
    engineer: engineer._id,
    locations: [],
  })
})
afterEach(() => vi.unstubAllGlobals())

const dictate = (as = asEngineer, audio = Buffer.from('fake-audio'), type = 'audio/webm') =>
  as.post(DICTATE).set('Content-Type', type).send(audio)

describe('dictating into an assessment (CP-27)', () => {
  it("returns S5's tidy text, transcribed with the assessment's privacy", async () => {
    const before = config.piiProtection
    config.piiProtection = 'required'
    try {
      s5Says({ transcript: 'The riser is not fire-stopped.', usage: [] })

      const res = await dictate()

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ text: 'The riser is not fire-stopped.' })
      expect(s5[0].url).toMatch(/\/transcribe-clip$/)
      expect(Buffer.from(String(s5[0].body.audio_base64), 'base64').toString()).toBe('fake-audio')
      expect(s5[0].body.privacy).toMatchObject({
        enabled: true,
        known_entities: expect.arrayContaining([
          { type: 'CLIENT', names: expect.arrayContaining(['Northgate Logistics']) },
        ]),
      })
    } finally {
      config.piiProtection = before
    }
  })
})

describe('who can dictate (CP-27)', () => {
  it('refuses without a session, and to someone who cannot open the assessment', async () => {
    s5Says({ transcript: 'never used' })

    const anonymous = request(app).post(DICTATE).set('Content-Type', 'audio/webm')
    expect((await anonymous.send(Buffer.from('x'))).status).toBe(401)
    expect((await dictate(signedInAs(app, colleague))).status).toBe(403)
    // A refused clip never reaches the speech service.
    expect(s5).toHaveLength(0)
  })

  it('refuses a file that is not audio, too large, or empty', async () => {
    s5Says({ transcript: 'never used' })

    expect((await dictate(asEngineer, Buffer.from('x'), 'text/plain')).status).toBe(415)
    expect((await dictate(asEngineer, Buffer.alloc(3 * 1024 * 1024))).status).toBe(413)
    expect((await dictate(asEngineer, Buffer.alloc(0))).status).toBe(400)
    expect(s5).toHaveLength(0)
  })
})

describe('when nothing usable comes back (CP-27)', () => {
  it('says so when no speech was heard', async () => {
    s5Says({ transcript: '   ', usage: [] })

    const res = await dictate()

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/no speech/i)
  })

  it('answers 503 with the reason when the speech service fails', async () => {
    s5Says({ detail: 'The speech service is busy.' }, 503)

    const res = await dictate()

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('The speech service is busy. Try again later.')
  })

  it("answers 422 with a short reason, never Whisper's raw text, when the clip is refused", async () => {
    s5Says(
      {
        detail:
          "Whisper could not transcribe the recording: Error code: 400 - {'error': {'message': 'Invalid file format.'}}",
      },
      422,
    )

    const res = await dictate()

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('The recording format is not supported. Record it again.')
  })
})

describe('MarshBot (CP-27)', () => {
  it('is not asked to re-check the assessment: dictating changes nothing in it', async () => {
    s5Says({ transcript: 'The riser is not fire-stopped.', usage: [] })
    queued.length = 0

    expect((await dictate()).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(queued).toEqual([])
  })
})
