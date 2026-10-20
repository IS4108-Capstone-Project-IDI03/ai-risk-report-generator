// Proposed figures for Sections 4 and 5 (GN-03 addendum, AC10, AC12-AC15): proposed
// from the observations and drafted sections, stored beside the figures, never computed
// from, refused once the engineer has entered figures. S4 is a stubbed fetch.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

useMemoryMongo()

const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
const REFERENCE = 'RPT-2026-0316'
const base = `/api/assessments/${REFERENCE}`
const ROOM = new Types.ObjectId()
const CATEGORIES = [
  'External Exposure',
  'Fire Protection',
  'Occupancy Hazards',
  'Construction',
  'Water Supply',
  'Surveillance',
  'Management Programs',
]
const ALL = ['Construction', 'Occupancy', 'Protection', 'Exposure']
const SECTIONS = [
  {
    id: '4',
    title: 'Risk Quality Ratings and Comments',
    cope_dimensions: ALL,
    min_observations: 1,
  },
  { id: '5', title: 'Loss Estimates', cope_dimensions: ALL, min_observations: 1 },
]
const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-test',
  effort: 'medium',
  prompt_version: 'gn03-prop-v1',
  generated_at: '2026-10-20T00:00:00+00:00',
}
const USAGE = [
  {
    // rag-service records every Claude call as draft-section, as for OFIs and the summary.
    feature: 'draft-section',
    billed_service: 'anthropic',
    model: 'claude-test',
    duration_ms: 10,
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 0,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
  },
]
const proposalOf = (sectionId: string) =>
  sectionId === '4'
    ? {
        categories: CATEGORIES.map((category) => ({
          category,
          current: 8,
          potential: 9,
          reason: 'Sprinklered throughout.',
          citations: ['O:x'],
        })),
      }
    : {
        levels: [
          {
            level: 'II',
            damage: [{ item: 'L27 to L29', percent: 100, reason: 'r', citations: ['O:x'] }],
            te: [
              {
                item: 'Business Interruption',
                months: 30,
                percent: 11,
                reason: 'r',
                citations: [],
              },
            ],
          },
        ],
      }

const proposals = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  proposals.mockImplementation((body) =>
    json({
      proposal: proposalOf(String(body.section_id)),
      usage: USAGE,
      provenance: PROVENANCE,
    }),
  )
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/figures/propose')
      ? proposals(JSON.parse(String(init!.body)))
      : json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => {
  proposals.mockReset()
  vi.unstubAllGlobals()
})

async function assessment() {
  const site = await SiteModel.create({
    code: 'SITE-0316',
    name: 'Tower',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  const a = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Client',
    surveyType: 'Survey',
    engineer: engineer._id,
    locations: [{ _id: ROOM, name: 'Pump room', key: 'pump room' }],
  })
  const session = await CaptureSessionModel.create({
    assessment: a._id,
    status: 'ready_for_generation',
  })
  await ObservationModel.create({
    assessment: a._id,
    session: session._id,
    engineer: engineer.name,
    note: 'Sprinklered throughout, 2 fire pumps.',
    recordings: [],
    severity: 'low',
    location: ROOM,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Office',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
  return a
}

describe('Section 4 proposed scores', () => {
  it('proposes from the observations, stores the proposal and computes nothing from it (AC12, AC13)', async () => {
    await assessment()
    const response = await api.post(`${base}/risk-quality/propose`)

    expect(response.status).toBe(200)
    const sent = proposals.mock.calls[0][0]
    expect(sent.section_id).toBe('4')
    expect((sent.observations as { note: string }[])[0].note).toContain('Sprinklered')
    // The proposal is shown, but the rating is computed from confirmed scores only.
    expect(response.body.proposal.categories[0]).toMatchObject({ current: 8, potential: 9 })
    expect(response.body.proposal.provenance.model).toBe('claude-test')
    expect(response.body.result.current).toBeNull()
    expect(response.body.categories.every((c: { current: null }) => c.current === null)).toBe(true)
    const reloaded = await api.get(`${base}/risk-quality`)
    expect(reloaded.body.proposal.categories).toHaveLength(7)
    // The paid call is recorded for the cost report, against Section 4.
    expect(await AiCallModel.countDocuments({ section: '4' })).toBe(1)
  })

  it('is refused once scores are entered, and the proposal is no longer shown (AC14)', async () => {
    await assessment()
    await api.post(`${base}/risk-quality/propose`)
    const confirmed = await api.put(`${base}/risk-quality`).send({
      categories: CATEGORIES.map((category) => ({ category, current: 7, potential: 9 })),
    })
    expect(confirmed.body.result.current.score).toBe(70)
    expect(confirmed.body.proposal).toBeNull()

    const again = await api.post(`${base}/risk-quality/propose`)
    expect(again.status).toBe(409)
    expect(proposals).toHaveBeenCalledTimes(1)
  })

  it('refuses a second proposal while one waits to be confirmed: another paid call', async () => {
    await assessment()
    await api.post(`${base}/risk-quality/propose`)
    const again = await api.post(`${base}/risk-quality/propose`)
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/already proposed/)
    expect(proposals).toHaveBeenCalledTimes(1)
  })

  it('reports a drafting service failure', async () => {
    await assessment()
    proposals.mockImplementation(() => json({ detail: 'The model returned no answer.' }, 502))
    const response = await api.post(`${base}/risk-quality/propose`)
    // 503, as for drafting: the client reads 502 as the gateway being down.
    expect(response.status).toBe(503)
    expect(response.body.error).toBe('The model returned no answer.')
  })
})

describe('Section 5 proposed figures', () => {
  it('sends the BI items and leaves months beyond the indemnity period blank (AC12, AC15)', async () => {
    await assessment()
    // Site values entered, no level figures yet: proposing is still allowed.
    await api.put(`${base}/loss-estimates`).send({
      currency: 'SGD',
      dateOfValues: '2026-01-01',
      indemnityMonths: 24,
      pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
      te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
      levels: [],
    })
    const response = await api.post(`${base}/loss-estimates/propose`)

    expect(response.status).toBe(200)
    expect(proposals.mock.calls[0][0].te_items).toEqual(['Business Interruption'])
    const [level] = response.body.proposal.levels
    expect(level.damage[0]).toMatchObject({ item: 'L27 to L29', percent: 100 })
    // 30 months is beyond the 24-month indemnity period: left for the engineer.
    expect(level.te[0]).toMatchObject({ months: null, percent: 11 })
  })

  it('stops showing the proposal once the figures are saved, even with no % entered', async () => {
    await assessment()
    await api.post(`${base}/loss-estimates/propose`)
    // The engineer gives the proposed area a value and saves; no % or months yet.
    const saved = await api.put(`${base}/loss-estimates`).send({
      currency: 'SGD',
      dateOfValues: '2026-01-01',
      indemnityMonths: 24,
      pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
      te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
      levels: [
        {
          level: 'II',
          pd: [],
          damageRows: [{ key: 'd', item: 'L27 to L29', value: 300_000, percent: null }],
          te: [],
        },
      ],
    })
    // Saving confirmed it: the form must not be refilled from the proposal.
    expect(saved.body.proposal).toBeNull()
    expect((await api.get(`${base}/loss-estimates`)).body.proposal).toBeNull()
  })

  it('is refused once a level has figures', async () => {
    await assessment()
    await api.put(`${base}/loss-estimates`).send({
      currency: 'SGD',
      dateOfValues: '2026-01-01',
      indemnityMonths: 24,
      pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
      te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
      levels: [{ level: 'I', pd: [{ key: 'b', percent: 5 }], te: [] }],
    })
    expect((await api.post(`${base}/loss-estimates/propose`)).status).toBe(409)
    expect(proposals).not.toHaveBeenCalled()
  })
})
