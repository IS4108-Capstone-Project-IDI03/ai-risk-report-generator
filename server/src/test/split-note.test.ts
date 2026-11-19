import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CP-35: POST /api/assessments/:reference/split-note. S4 is a stubbed fetch; nothing is paid.
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
const split = (note: unknown, who = api) =>
  who.post('/api/assessments/RPT-1/split-note').send({ note })

describe('splitting a shorthand note (CP-35)', () => {
  it('types coded lines by my codes and makes no rag call when all are coded', async () => {
    const res = await split('F: pump house locked\nir: roof plan\n REC : fit sprinklers')
    expect(res.status).toBe(200)
    expect(res.body.parts.map((p: { kind: string }) => p.kind)).toEqual([
      'fact',
      'info_request',
      'recommendation',
    ])
    expect(res.body.parts[1]).toMatchObject({
      text: 'roof plan',
      shorthand: 'ir: roof plan',
      inferred: false,
      flags: [],
    })
    expect(rag).not.toHaveBeenCalled()
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('calls rag once with only the raw uncoded lines, my glossary and privacy, keeping line order', async () => {
    await api
      .patch('/api/settings/me')
      .send({ glossary: [{ term: 'FE', meaning: 'fire extinguisher' }] })
    rag.mockReturnValue(
      json({
        parts: [
          {
            kind: 'fact',
            text: 'Northgate FE missing',
            shorthand: 'Northgate FE missing',
            line: 0,
            flags: [],
          },
          {
            kind: 'info_request',
            text: 'Ask for the plan',
            shorthand: 'Northgate FE missing',
            line: 0,
            flags: [],
          },
          {
            kind: 'recommendation',
            text: 'Fit a sprinkler',
            shorthand: 'sprinkler pls',
            line: 1,
            flags: [{ type: 'unknown_term', detail: 'pls' }],
          },
        ],
        usage: [
          {
            feature: 'x',
            billed_service: 'anthropic',
            model: 'm',
            input_tokens: 5,
            output_tokens: 2,
          },
        ],
      }),
    )
    const res = await split('Northgate FE missing\nF: coded one\nsprinkler pls')
    expect(rag).toHaveBeenCalledTimes(1)
    const sent = rag.mock.calls[0][0] as {
      lines: string[]
      glossary: unknown[]
      privacy: { enabled: boolean }
    }
    expect(sent.lines).toEqual(['Northgate FE missing', 'sprinkler pls'])
    expect(sent.glossary).toEqual([{ term: 'FE', meaning: 'fire extinguisher' }])
    expect(sent.privacy).toHaveProperty('enabled')
    expect(
      res.body.parts.map((p: { text: string; inferred: boolean }) => [p.text, p.inferred]),
    ).toEqual([
      ['Northgate FE missing', true],
      ['Ask for the plan', true],
      ['coded one', false],
      ['Fit a sprinkler', true],
    ])
    expect(res.body.parts[3].flags).toEqual([{ type: 'unknown_term', detail: 'pls' }])
    expect((await AiCallModel.findOne({ feature: 'split-note' }).lean())?.reportId).toBe('RPT-1')
  })

  const texts = (res: { body: { parts: { text: string }[] } }) => res.body.parts.map((p) => p.text)
  const part = (text: string, line: number, shorthand = 'frag') => ({
    kind: 'fact',
    text,
    shorthand,
    line,
  })

  it('drops a line that is only a code, and makes no AI call for it', async () => {
    const res = await split('F:\nIR:   \nREC :\nF: pump room dry')
    expect(res.status).toBe(200)
    expect(res.body.parts).toHaveLength(1)
    expect(res.body.parts[0]).toMatchObject({ kind: 'fact', text: 'pump room dry' })
    expect(rag).not.toHaveBeenCalled()
  })

  it('keeps a line split into two fragments together at its position', async () => {
    rag.mockReturnValue(json({ parts: [part('a1', 0), part('a2', 0), part('b1', 1)] }))
    const res = await split('line a\nF: coded\nline b')
    expect(texts(res)).toEqual(['a1', 'a2', 'coded', 'b1'])
  })

  it('gives two identical uncoded lines their own parts', async () => {
    rag.mockReturnValue(json({ parts: [part('first', 0, 'same'), part('second', 1, 'same')] }))
    const res = await split('same\nsame')
    expect(texts(res)).toEqual(['first', 'second'])
  })

  it('keeps mixed coded and uncoded lines in note order', async () => {
    rag.mockReturnValue(json({ parts: [part('u1', 0), part('u2', 1)] }))
    const res = await split('F: c1\nraw1\nF: c2\nraw2')
    expect(texts(res)).toEqual(['c1', 'u1', 'c2', 'u2'])
  })

  it('puts a part with an out-of-range line after the last position', async () => {
    rag.mockReturnValue(json({ parts: [part('stray', 9), part('u1', 0)] }))
    const res = await split('raw1\nF: c1')
    expect(texts(res)).toEqual(['u1', 'c1', 'stray'])
  })

  it('passes real names from rag straight through (rag unmasks inside)', async () => {
    rag.mockReturnValue(
      json({ parts: [{ kind: 'fact', text: 'Northgate yard', shorthand: 'Northgate yard' }] }),
    )
    const res = await split('Northgate yard')
    expect(res.body.parts[0].text).toBe('Northgate yard')
  })

  it('answers 503 when rag could not protect client details, and saves nothing', async () => {
    rag.mockReturnValue(json({ detail: 'privacy down' }, 503))
    const res = await split('some note')
    expect(res.status).toBe(503)
    expect(await ObservationModel.countDocuments()).toBe(0)
  })

  it('answers 502 when rag fails', async () => {
    rag.mockReturnValue(json({ detail: 'boom' }, 500))
    expect((await split('some note')).status).toBe(502)
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(6000)],
    ['not text', 5],
  ])('refuses a %s note with 400', async (_n, note) => {
    expect((await split(note)).status).toBe(400)
    expect(rag).not.toHaveBeenCalled()
  })

  it('refuses an engineer who is not assigned, as saving an observation does', async () => {
    expect((await split('F: x', stranger)).status).toBe(403)
  })
})
