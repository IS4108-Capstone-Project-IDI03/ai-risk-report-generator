import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ObservationModel, type Severity } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
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
const REFERENCE = 'RPT-2026-0901'
const BAY = new Types.ObjectId()

// S4 stands in as a stubbed fetch, answering /ofis/draft with the OFIs given.
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const OFI = {
  title: 'Supervise sprinkler control valves',
  category: 'Physical Protection',
  type: 'Fire Protection System',
  description: 'Supervise control valves in the open position, as per NFPA 25.',
  observation: 'As observed at the Basement 1 fire pump room, the valve was shut.',
  likelihood: 'Likely',
  consequence: 'Major',
  priority: 'Priority 1',
  effort: 'Minor Capital',
  observations: [] as string[],
  standards: ['C:nfpa25:12'],
  precedent: 'P:rep:40',
}
const reply = (ofis: object[]) => ({
  ofis,
  sources: { 'P:rep:40': { text: '2025-02: …', doc_id: 'mall-2', headings: ['OFI'] } },
  provenance: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    prompt_version: 'gn05-v1',
    config_version: 'ofi-config-2026-10-08',
    generated_at: '2026-10-08T00:00:00+00:00',
  },
})

beforeEach(() => {
  drafts.mockImplementation(() => json(reply([OFI])))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/ofis/draft') ? drafts(JSON.parse(String(init!.body))) : json({}),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

async function assessment() {
  const site = await SiteModel.create({
    code: 'SITE-0901',
    name: 'Marina Bay Office Tower',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  const created = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Client',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-09-28'),
    standards: ['NFPA 25'],
    engineer: engineer._id,
    locations: [{ _id: BAY, name: 'Fire pump room', floor: 'Basement 1', key: 'fpr|b1' }],
  })
  const session = await CaptureSessionModel.create({
    assessment: created._id,
    status: 'ready_for_generation',
  })
  return { assessment: created, session }
}

async function observation(
  ids: { assessment: Types.ObjectId; session: Types.ObjectId },
  note: string,
  severity: Severity = 'critical',
) {
  return ObservationModel.create({
    assessment: ids.assessment,
    session: ids.session,
    engineer: engineer.name,
    note,
    recordings: [],
    severity,
    location: BAY,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Office',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
}

const url = `/api/assessments/${REFERENCE}/ofis`

describe('Opportunities for Improvement (GN-05)', () => {
  it('drafts suggestions from usable observations and keeps them out of the report', async () => {
    const { assessment: a, session } = await assessment()
    const valve = await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    drafts.mockImplementation(() => json(reply([{ ...OFI, observations: [String(valve._id)] }])))

    const response = await api.post(`${url}/draft`)

    expect(response.status).toBe(201)
    const sent = drafts.mock.calls[0][0]
    expect(sent.assessment).toMatchObject({ reference: REFERENCE, jurisdiction: 'SG' })
    expect(sent.observations).toEqual([
      expect.objectContaining({ id: String(valve._id), note: 'B1 CV shut', severity: 'critical' }),
    ])
    expect(sent.accepted).toEqual([])
    // AC3: a suggestion is not in the report until accepted; AC2: its precedent travels with it.
    expect(response.body.accepted).toEqual([])
    expect(response.body.suggestions).toEqual([
      expect.objectContaining({
        title: OFI.title,
        // Marsh's fixed fields, shown on the suggestion's table too.
        status: 'New',
        issueDate: '2026-09-28T00:00:00.000Z',
        priority: 'Priority 1',
        precedent: 'P:rep:40',
        sources: { 'P:rep:40': expect.objectContaining({ doc_id: 'mall-2' }) },
      }),
    ])
    const saved = await ReportOfiModel.findOne().lean()
    expect(saved?.state).toBe('suggested')
    expect(saved?.metadata).toMatchObject({
      source_type: 'ofi',
      jurisdiction: 'SG',
      facility_type: 'Office',
      COPE_dimension: 'all',
    })
    expect(saved?.provenance.prompt_version).toBe('gn05-v1')
  })

  it('accepts a suggestion into the report, numbered in report order (AC4)', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    drafts.mockImplementation(() =>
      json(
        reply([
          OFI,
          { ...OFI, title: 'Improve Hot Work Permit', category: 'Management Programs' },
          { ...OFI, title: 'Lock open hosereel valve' },
        ]),
      ),
    )
    const { suggestions } = (await api.post(`${url}/draft`)).body
    const id = (title: string) => suggestions.find((s: { title: string }) => s.title === title).id

    await api.post(`${url}/${id(OFI.title)}/accept`)
    await api.post(`${url}/${id('Improve Hot Work Permit')}/accept`)
    const response = await api.post(`${url}/${id(OFI.title)}/accept`) // twice: no change

    expect(response.status).toBe(200)
    // Management Programs come first, then Physical Protection, each by acceptance time;
    // numbered by the site visit's year, with Marsh's fixed fields filled in.
    expect(response.body.accepted).toEqual([
      expect.objectContaining({
        number: '2026-01',
        title: 'Improve Hot Work Permit',
        status: 'New',
        issueDate: '2026-09-28T00:00:00.000Z',
      }),
      expect.objectContaining({ number: '2026-02', title: OFI.title }),
    ])
    expect(response.body.suggestions.map((s: { title: string }) => s.title)).toEqual([
      'Lock open hosereel valve',
    ])
    const accepted = await ReportOfiModel.findOne({ title: OFI.title }).lean()
    expect(String(accepted?.acceptedBy)).toBe(String(engineer._id))
  })

  it('redrafting replaces suggestions, keeps accepted OFIs and tells S4 about them', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    drafts.mockImplementation(() =>
      json(reply([OFI, { ...OFI, title: 'Lock open hosereel valve' }])),
    )
    const first = (await api.post(`${url}/draft`)).body.suggestions
    await api.post(`${url}/${first[0].id}/accept`)
    drafts.mockImplementation(() => json(reply([{ ...OFI, title: 'Improve housekeeping' }])))

    const response = await api.post(`${url}/draft`)

    expect(drafts.mock.calls[1][0].accepted).toEqual([OFI.title])
    expect(response.body.accepted.map((o: { title: string }) => o.title)).toEqual([OFI.title])
    expect(response.body.suggestions.map((o: { title: string }) => o.title)).toEqual([
      'Improve housekeeping',
    ])
  })

  it("names the precedent's report by its title, never its id (AC2)", async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    const report = await KnowledgeDocumentModel.create({
      title: 'Shopping Mall PRE 2025',
      issuingBody: 'Marsh',
      fileName: 'mall.pdf',
      file: { key: 'knowledge/x.pdf', contentType: 'application/pdf', size: 10, sha256: 'abc' },
      status: 'complete',
      metadata: {
        source_type: 'marsh_report',
        jurisdiction: 'SG',
        facility_type: 'all',
        COPE_dimension: 'all',
        effective_date: new Date('2025-10-30'),
      },
    })
    const known = String(report._id)
    drafts.mockImplementation(() =>
      json({
        ...reply([OFI, { ...OFI, title: 'Unknown source', precedent: 'P:other:1' }]),
        sources: {
          'P:rep:40': { text: '…', doc_id: known },
          'P:other:1': { text: '…', doc_id: '6ac21227405acbadf814fae9' },
        },
      }),
    )

    const { suggestions } = (await api.post(`${url}/draft`)).body

    expect(suggestions.map((o: { precedentReport: string | null }) => o.precedentReport)).toEqual([
      'Shopping Mall PRE 2025',
      null,
    ])
  })

  it('records the paid calls that drafted the OFIs under the report (EV-03)', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    drafts.mockImplementation(() =>
      json({
        ...reply([OFI]),
        usage: [
          {
            feature: 'draft-section',
            billed_service: 'anthropic',
            model: 'claude-sonnet-5-5',
            duration_ms: 12000,
            input_tokens: 15000,
            output_tokens: 1200,
            cache_read_tokens: null,
            search_units: null,
            audio_seconds: null,
            usage_status: 'recorded',
          },
        ],
      }),
    )

    const response = await api.post(`${url}/draft`)

    const rows = await AiCallModel.find({ reportId: REFERENCE }).lean()
    expect(rows.map((r) => r.billedService)).toEqual(['anthropic'])
    // Bookkeeping only: it does not reach the browser.
    expect(JSON.stringify(response.body)).not.toContain('billed_service')
  })

  it('keeps the old suggestions when a redraft cannot be saved', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    await api.post(`${url}/draft`)
    // An OFI the schema rejects (no description) fails the save.
    drafts.mockImplementation(() => json(reply([{ ...OFI, title: 'New', description: '' }])))

    expect((await api.post(`${url}/draft`)).status).toBe(500)

    const { suggestions } = (await api.get(url)).body
    expect(suggestions.map((o: { title: string }) => o.title)).toEqual([OFI.title])
  })

  it('only lets the assigned engineer draft or accept, and waits for transcriptions', async () => {
    const { assessment: a, session } = await assessment()
    const valve = await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    const { suggestions } = (await api.post(`${url}/draft`)).body

    const otherEngineer = signedInAsRole(app, 'risk_engineer')
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await otherEngineer.post(`${url}/draft`)).status).toBe(403)
    expect((await otherEngineer.post(`${url}/${suggestions[0].id}/accept`)).status).toBe(403)
    expect((await admin.get(url)).status).toBe(200)
    expect((await api.post(`${url}/${new Types.ObjectId()}/accept`)).status).toBe(404)
    expect((await api.post(`${url}/not-an-id/accept`)).status).toBe(404)
    expect((await api.get('/api/assessments/RPT-NONE/ofis')).status).toBe(404)

    await ObservationModel.updateOne(
      { _id: valve._id },
      {
        recordings: [
          {
            name: 'Recording 1',
            key: 'audio/x.webm',
            contentType: 'audio/webm',
            size: 3,
            transcription: { status: 'transcribing', attempts: [{ startedAt: new Date() }] },
          },
        ],
      },
    )
    expect((await api.post(`${url}/draft`)).status).toBe(409)
  })

  it('names the reason when drafting fails', async () => {
    const { assessment: a, session } = await assessment()
    await observation({ assessment: a._id, session: session._id }, 'B1 CV shut')
    drafts.mockImplementation(() => json({ detail: 'The model declined to draft.' }, 502))

    const response = await api.post(`${url}/draft`)

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('The model declined to draft.')
  })
})
