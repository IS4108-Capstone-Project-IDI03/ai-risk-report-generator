import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

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
const REFERENCE = 'RPT-2026-0411'
const BAY_3 = new Types.ObjectId()

// S4 stands in as a stubbed fetch: the template's sections and a fixed draft.
const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
  {
    id: '12',
    title: 'Business Interruption',
    cope_dimensions: ['Exposure', 'Occupancy'],
    min_observations: 2,
  },
]
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const DRAFT = {
  section_id: '7',
  title: 'Construction',
  subsections: [
    {
      heading: 'Construction Narrative',
      kind: 'narrative',
      statements: [{ text: 'Risers were not fire-stopped.', citations: ['O:x'], supported: true }],
    },
    { heading: 'Construction Table', kind: 'table', statements: [] },
  ],
  sources: {},
  questions: ['Is there a recent riser survey?'],
  guardrail: { passed: true, unsupported_count: 0 },
  provenance: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    prompt_version: 'gn01-v1',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-03T00:00:00+00:00',
  },
}

beforeEach(() => {
  drafts.mockImplementation(() => json(DRAFT))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/sections/draft')
      ? drafts(JSON.parse(String(init!.body)))
      : json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

async function assessment(status: CaptureSessionStatus = 'ready_for_generation', extra = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const created = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    standards: ['FM Global 2-0'],
    engineer: engineer._id,
    locations: [{ _id: BAY_3, name: 'Bay 3', floor: 'Ground', key: 'bay 3|ground' }],
    ...extra,
  })
  const session = await CaptureSessionModel.create({ assessment: created._id, status })
  return { assessment: created, session }
}

type Transcription = 'transcribing' | 'transcribed' | 'failed'
async function observation(
  ids: { assessment: Types.ObjectId; session: Types.ObjectId },
  copeDimension: CopeDimension | null,
  { note, transcription }: { note?: string; transcription?: Transcription } = {},
) {
  return ObservationModel.create({
    assessment: ids.assessment,
    session: ids.session,
    engineer: engineer.name,
    note,
    recordings: transcription
      ? [
          {
            name: 'Recording 1',
            key: 'audio/x.webm',
            contentType: 'audio/webm',
            size: 3,
            transcription: {
              status: transcription,
              transcript: transcription === 'transcribed' ? 'Curtain wall gaps sealed.' : undefined,
              attempts: [{ startedAt: new Date() }],
            },
          },
        ]
      : [],
    severity: 'high',
    location: BAY_3,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: copeDimension,
      effective_date: new Date(),
    },
  })
}

describe('drafting a report section (GN-01)', () => {
  it("drafts from the assessment's usable observations and saves the provenance", async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    const noted = await observation(ids, 'Construction', { note: 'Risers on L3 not fire-stopped.' })
    const voiced = await observation(ids, 'Construction', { transcription: 'transcribed' })
    await observation(ids, 'Construction', { transcription: 'failed' })
    await observation(ids, null, { note: 'Uncategorised.' })
    const sprinklers = await observation(ids, 'Protection', { note: 'Heads under mezzanine.' })

    const response = await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)

    expect(response.status).toBe(201)
    const sent = drafts.mock.calls[0][0]
    expect(sent.section_id).toBe('7')
    expect(sent.assessment).toEqual({
      reference: REFERENCE,
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      standards: ['FM Global 2-0'],
    })
    // Every usable categorised observation goes, other categories as backup
    // for S4 to place; no failed recording alone, no uncategorised one.
    expect(sent.observations).toEqual([
      {
        id: String(noted._id),
        COPE_dimension: 'Construction',
        note: 'Risers on L3 not fire-stopped.',
        transcripts: [],
        severity: 'high',
        location: 'Bay 3, Ground',
        standard: null,
      },
      expect.objectContaining({
        id: String(voiced._id),
        note: null,
        transcripts: ['Curtain wall gaps sealed.'],
      }),
      expect.objectContaining({ id: String(sprinklers._id), COPE_dimension: 'Protection' }),
    ])

    const saved = await ReportSectionModel.findOne().lean()
    expect(saved?.provenance).toMatchObject({
      model: 'claude-opus-5-5',
      prompt_version: 'gn01-v1',
      template_version: 'global-pre-v2.0-2026-02',
      effort: 'high',
    })
    expect(saved?.metadata).toMatchObject({
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
    })
    expect(saved?.metadata.effective_date).toBeInstanceOf(Date)
    expect(response.body).toMatchObject({ id: String(saved?._id), sectionId: '7' })
    expect(response.body.subsections[0].statements[0].citations).toEqual(['O:x'])
    // No standard cited: still an object, though Mongoose drops it when empty.
    expect(response.body.sources).toEqual({})
    // Questions for the engineer are saved with the draft and returned.
    expect(response.body.questions).toEqual(['Is there a recent riser survey?'])
    expect((await ReportSectionModel.findOne().lean())?.questions).toEqual([
      'Is there a recent riser survey?',
    ])
    expect((await AssessmentModel.findById(a._id).lean())?.reportStatus).toBe('draft')

    // The section list shows the newest draft and the usable evidence count.
    const list = await api.get(`/api/assessments/${REFERENCE}/sections`)
    expect(list.body[0]).toMatchObject({
      id: '7',
      usableObservations: 2,
      latestDraft: { id: String(saved?._id) },
    })
    expect(list.body[1]).toMatchObject({ id: '12', usableObservations: 0, latestDraft: null })
  })

  it('tags a section spanning several categories as all', async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    await observation(ids, 'Exposure', { note: 'Single supplier.' })
    await observation(ids, 'Occupancy', { note: 'One production line.' })

    expect((await api.post(`/api/assessments/${REFERENCE}/sections/12/draft`)).status).toBe(201)
    expect((await ReportSectionModel.findOne().lean())?.metadata.COPE_dimension).toBe('all')
  })

  it('refuses a section without enough evidence of its own', async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    await observation(ids, 'Exposure', { note: 'One.' })
    // Backup evidence from another category does not count towards it.
    await observation(ids, 'Construction', { note: 'Two.' })

    const response = await api.post(`/api/assessments/${REFERENCE}/sections/12/draft`)

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ found: 1, needed: 2 })
    expect(drafts).not.toHaveBeenCalled()
  })

  it('drafts while capture is open, but waits for transcriptions to finish', async () => {
    const { assessment: a, session } = await assessment('active')
    const ids = { assessment: a._id, session: session._id }
    await observation(ids, 'Construction', { note: 'Noted.' })
    expect((await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)).status).toBe(201)

    await observation(ids, 'Construction', { transcription: 'transcribing' })
    const response = await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)
    expect(response.status).toBe(409)
    expect(response.body.error).toMatch(/still being transcribed/)
    expect(drafts).toHaveBeenCalledTimes(1)
  })

  it('keeps the evidence a draft was given and counts what has changed since', async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    const riser = await observation(ids, 'Construction', { note: 'Riser not fire-stopped.' })
    await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)
    const sections = async () => (await api.get(`/api/assessments/${REFERENCE}/sections`)).body[0]

    expect((await ReportSectionModel.findOne().lean())?.evidence).toEqual([
      expect.objectContaining({ id: String(riser._id), note: 'Riser not fire-stopped.' }),
    ])
    expect((await sections()).changesSinceDraft).toBe(0)

    // A new observation, and a change to the one the draft used.
    await observation(ids, 'Construction', { note: 'Curtain wall sealed.' })
    await ObservationModel.updateOne({ _id: riser._id }, { severity: 'critical' })
    expect((await sections()).changesSinceDraft).toBe(2)
    // The saved evidence still shows the observation as it was drafted from.
    expect((await ReportSectionModel.findOne().lean())?.evidence[0].severity).toBe('high')

    // Redrafting takes them in.
    await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)
    expect((await sections()).changesSinceDraft).toBe(0)
  })

  it('only lets the assigned engineer draft, and not an archived assessment', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'Construction', { note: 'x' })

    const otherEngineer = signedInAsRole(app, 'risk_engineer')
    const admin = signedInAsRole(app, 'knowledge_admin')
    const url = `/api/assessments/${REFERENCE}/sections/7/draft`
    expect((await otherEngineer.post(url)).status).toBe(403)
    expect((await admin.post(url)).status).toBe(403)
    // The admin can still read the drafts.
    expect((await admin.get(`/api/assessments/${REFERENCE}/sections`)).status).toBe(200)

    await AssessmentModel.updateOne({ _id: a._id }, { archivedAt: new Date() })
    expect((await api.post(url)).status).toBe(409)
    expect(await ReportSectionModel.countDocuments()).toBe(0)
  })

  it('reports unknown sections and assessments, and drafting failures', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'Construction', { note: 'x' })

    expect((await api.post(`/api/assessments/${REFERENCE}/sections/3/draft`)).status).toBe(404)
    expect((await api.post('/api/assessments/RPT-2026-9999/sections/7/draft')).status).toBe(404)

    drafts.mockImplementation(() =>
      json({ detail: 'The model declined to draft this section.' }, 502),
    )
    const failed = await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)
    expect(failed.status).toBe(503)
    expect(failed.body.error).toBe('The model declined to draft this section.')
    expect(await ReportSectionModel.countDocuments()).toBe(0)
  })
})
