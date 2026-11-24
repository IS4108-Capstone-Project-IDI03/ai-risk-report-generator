import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CP-36: POST /api/assessments/:reference/suggest-kinds. S4 is a stubbed fetch; nothing is paid.
useMemoryMongo()

const user = (name: string) => ({
  _id: new Types.ObjectId(),
  staffId: name,
  name,
  email: `${name}@example.com`,
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = user('Alex')
const api = signedInAs(app, alex)
const stranger = signedInAs(app, user('Ben'))

const rag = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(async () => {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) =>
    rag(JSON.parse(String(init.body))),
  )
  const site = await SiteModel.create({
    code: 'S-1',
    name: 'Tilbury DC',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  await AssessmentModel.create({
    reference: 'RPT-1',
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    engineer: alex._id,
  })
})
afterEach(() => {
  rag.mockReset()
  vi.unstubAllGlobals()
})
const suggest = (text: unknown, who = api) =>
  who.post('/api/assessments/RPT-1/suggest-kinds').send({ text })

describe('suggesting tags for a note (CP-36)', () => {
  it('sends the raw text with privacy to rag, returns its tags and saves nothing', async () => {
    rag.mockReturnValue(json({ kinds: ['fact', 'recommendation'], usage: [] }))
    const res = await suggest('Pump is 20 years old, replace it')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kinds: ['fact', 'recommendation'] })
    expect(rag.mock.calls[0][0]).toMatchObject({ text: 'Pump is 20 years old, replace it' })
    expect(rag.mock.calls[0][0]).toHaveProperty('privacy')
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('does not read a code at the start of the text', async () => {
    rag.mockReturnValue(json({ kinds: ['fact'], usage: [] }))
    await suggest('IR: ask for the roof plan')
    expect(rag.mock.calls[0][0].text).toBe('IR: ask for the roof plan')
  })

  it('records the paid call as suggest-kinds', async () => {
    rag.mockReturnValue(
      json({
        kinds: ['fact'],
        usage: [
          {
            feature: 'x',
            billed_service: 'anthropic',
            model: 'm',
            input_tokens: 10,
            output_tokens: 2,
          },
        ],
      }),
    )
    await suggest('Valve shut')
    expect(await AiCallModel.countDocuments({ feature: 'suggest-kinds' })).toBe(1)
  })

  it('answers 503 when client details could not be protected, and 502 for other failures', async () => {
    rag.mockReturnValue(json({ detail: 'privacy' }, 503))
    expect((await suggest('x')).status).toBe(503)
    rag.mockReturnValue(json({ detail: 'boom' }, 500))
    expect((await suggest('x')).status).toBe(502)
  })

  it('refuses an empty or over-long text, an unassigned engineer, and an unknown assessment', async () => {
    expect((await suggest('   ')).status).toBe(400)
    expect((await suggest('x'.repeat(5001))).status).toBe(400)
    expect((await suggest('Valve shut', stranger)).status).toBe(403)
    expect((await api.post('/api/assessments/NOPE/suggest-kinds').send({ text: 'x' })).status).toBe(
      404,
    )
    expect(rag).not.toHaveBeenCalled()
  })

  it('drops an unknown tag from the answer and falls back to Fact when none is left', async () => {
    rag.mockReturnValue(json({ kinds: ['opinion'], usage: [] }))
    expect((await suggest('x')).body.kinds).toEqual(['fact'])
  })
})
