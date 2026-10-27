import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ChecklistModel } from '../models/checklist.model'
import { KnowledgeDocumentModel, type SourceType } from '../models/knowledge-document.model'
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
const REFERENCE = 'RPT-2026-0517'
const url = `/api/assessments/${REFERENCE}/checklist`

// S4 stands in as a stubbed fetch, answering /checklist/draft.
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const reply = (model: string | null = 'claude-opus-5-5') => ({
  items: [
    {
      area: '7',
      subsection: 'Construction Narrative',
      origin: 'template',
      hazard: null,
      text: 'Walls, roof, frame and floors',
      fields: [],
      COPE_dimension: ['Construction'],
      citations: [],
      flags: [],
    },
    {
      area: 'hazards',
      subsection: null,
      origin: 'hazard',
      hazard: 'rack_storage',
      text: 'Check in-rack sprinklers are fitted for racks over 7.6 m.',
      fields: [],
      COPE_dimension: ['Occupancy', 'Protection'],
      citations: [{ ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quote_found: true }],
      flags: [],
    },
  ],
  areas: [{ id: '7', title: 'Construction' }],
  hazards: [
    { id: 'rack_storage', name: 'Rack storage', standards: ['NFPA 13'], in_scope: ['NFPA 13'] },
  ],
  sources: { 'C:nfpa13:118': { text: 'In-rack sprinklers…', page_start: 118 } },
  usage: [
    {
      feature: 'draft-section',
      billed_service: 'anthropic',
      model: 'claude-opus-5-5',
      duration_ms: 20000,
      input_tokens: 9000,
      output_tokens: 1500,
      cache_read_tokens: null,
      search_units: null,
      audio_seconds: null,
      usage_status: 'recorded',
    },
  ],
  provenance: {
    provider: 'anthropic',
    model,
    effort: 'medium',
    prompt_version: 'cp30-v1',
    checklist_version: 'checklist-v1-2026-10',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-26T06:00:00+00:00',
  },
})

beforeEach(() => {
  drafts.mockImplementation(() => json(reply()))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/checklist/draft') ? drafts(JSON.parse(String(init!.body))) : json({}),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

async function assessment(extra: Record<string, unknown> = {}) {
  const site = await SiteModel.create({
    code: 'SITE-0517',
    name: 'Tuas DC',
    jurisdiction: 'SG',
    facilityType: 'Distribution warehouse',
  })
  return AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Northgate Logistics',
    surveyType: 'Property risk survey',
    siteVisitDate: new Date('2026-11-03'),
    engineer: engineer._id,
    ...extra,
  })
}

let files = 0
async function standard(
  title: string,
  labels: { source_type?: SourceType; facility_type?: string; jurisdiction?: string } = {},
  extra: Record<string, unknown> = {},
) {
  files += 1
  const doc = await KnowledgeDocumentModel.create({
    title,
    issuingBody: 'NFPA',
    standardNumber: '13',
    edition: '2025',
    fileName: `${files}.pdf`,
    file: {
      key: `knowledge/${files}.pdf`,
      contentType: 'application/pdf',
      size: 10,
      sha256: `sha-${files}`,
    },
    status: 'complete',
    metadata: {
      source_type: 'nfpa_standard',
      jurisdiction: 'all',
      facility_type: 'all',
      effective_date: new Date('2025-01-01'),
      ...labels,
    },
    ...extra,
  })
  return String(doc._id)
}

describe('Pre-survey checklist (CP-30)', () => {
  it('lists only the standards that apply to the site, before any checklist (AC1)', async () => {
    await assessment()
    const sprinklers = await standard('NFPA 13 Sprinkler Systems')
    const warehouses = await standard('FM 8-9 Storage', {
      source_type: 'fm_standard',
      facility_type: 'Distribution warehouse',
    })
    const local = await standard('SS 575 Hydrants', {
      source_type: 'local_standard',
      jurisdiction: 'SG',
    })
    await standard('NFPA 75 IT Equipment', { facility_type: 'Office' })
    await standard('Malaysian code', { source_type: 'local_standard', jurisdiction: 'MY' })
    await standard('Tuas DC report 2024', { source_type: 'marsh_report' })
    await standard(
      'Withdrawn edition',
      {},
      { withdrawn: { at: new Date(), by: { id: 'a', name: 'Sana' } } },
    )
    await standard('Unconfirmed edition', {}, { unconfirmed: ['edition'] })
    await standard(
      'Possible copy',
      {},
      {
        match: {
          kind: 'possible_copy',
          documentId: new Types.ObjectId(),
          newMatched: 9,
          newTotal: 10,
          storedMatched: 9,
          storedTotal: 10,
        },
      },
    )
    await standard('Still ingesting', {}, { status: 'processing' })

    const response = await api.get(url)

    expect(response.status).toBe(200)
    expect(response.body.scope).toEqual({
      facilityType: 'Distribution warehouse',
      jurisdiction: 'SG',
    })
    expect(response.body.standards.map((s: { id: string }) => s.id).sort()).toEqual(
      [sprinklers, warehouses, local].sort(),
    )
    // When each was added, so the tab can tick one added since the last checklist.
    expect(response.body.standards[0].uploadedAt).toEqual(expect.any(String))
    expect(response.body.checklist).toBeNull()
  })

  it('generates from the ticked standards only, sending no client detail (AC2)', async () => {
    await assessment()
    const sprinklers = await standard('NFPA 13 Sprinkler Systems')
    await standard('FM 8-9 Storage', { source_type: 'fm_standard' })

    const response = await api.post(url).send({ standardIds: [sprinklers] })

    expect(response.status).toBe(201)
    const sent = drafts.mock.calls[0][0]
    expect(sent).toEqual({
      facility_type: 'Distribution warehouse',
      jurisdiction: 'SG',
      standards: [{ id: sprinklers, source_type: 'nfpa_standard', standard_number: '13' }],
    })
    expect(JSON.stringify(sent)).not.toMatch(/Northgate|Tuas/)
    const { checklist } = response.body
    expect(checklist.standards).toEqual([
      expect.objectContaining({ id: sprinklers, title: 'NFPA 13 Sprinkler Systems' }),
    ])
    // Each item has an id for later stories to refer to, and its citation's quote.
    expect(checklist.items).toHaveLength(2)
    expect(checklist.items[1]).toMatchObject({
      id: expect.any(String),
      hazard: 'rack_storage',
      citations: [{ ref: 'C:nfpa13:118', quote: 'rack storage over 7.6 m', quoteFound: true }],
      status: 'active',
      prefill: null,
      check: null,
    })
    expect(checklist.hazards).toEqual([
      { id: 'rack_storage', name: 'Rack storage', standards: ['NFPA 13'], inScope: ['NFPA 13'] },
    ])
    expect(checklist.provenance).toMatchObject({
      model: 'claude-opus-5-5',
      prompt_version: 'cp30-v1',
    })
    // Its paid calls are recorded under the checklist, for the report (EV-03).
    const calls = await AiCallModel.find().lean()
    expect(calls).toEqual([
      expect.objectContaining({ feature: 'checklist', reportId: REFERENCE, inputTokens: 9000 }),
    ])
  })

  it('shows the latest checklist on reopening and keeps earlier ones (AC9)', async () => {
    await assessment()
    await api.post(url).send({ standardIds: [] })
    drafts.mockImplementation(() =>
      json({ ...reply(), provenance: { ...reply().provenance, prompt_version: 'cp30-v2' } }),
    )
    await api.post(url).send({ standardIds: [] })

    const response = await api.get(url)

    expect(response.body.checklist.provenance.prompt_version).toBe('cp30-v2')
    expect(await ChecklistModel.countDocuments()).toBe(2)
    // A knowledge admin can read it too.
    const admin = await signedInAsRole(app, 'knowledge_admin').get(url)
    expect(admin.status).toBe(200)
  })

  it('generates with no standards, with no model named (AC10)', async () => {
    await assessment()
    drafts.mockImplementation(() => json(reply(null)))

    const response = await api.post(url).send({ standardIds: [] })

    expect(response.status).toBe(201)
    expect(drafts.mock.calls[0][0].standards).toEqual([])
    expect(response.body.checklist.provenance.model).toBeNull()
  })

  it('refuses a standard that does not apply to the site', async () => {
    await assessment()
    const office = await standard('NFPA 75', { facility_type: 'Office' })

    const response = await api.post(url).send({ standardIds: [office] })

    expect(response.status).toBe(400)
    expect(drafts).not.toHaveBeenCalled()
  })

  it('refuses anyone but the assigned engineer, and an archived assessment (AC11)', async () => {
    await assessment()
    expect(
      (await signedInAsRole(app, 'risk_engineer').post(url).send({ standardIds: [] })).status,
    ).toBe(403)
    expect(
      (await signedInAsRole(app, 'knowledge_admin').post(url).send({ standardIds: [] })).status,
    ).toBe(403)
    await AssessmentModel.updateOne({ reference: REFERENCE }, { archivedAt: new Date() })
    expect((await api.post(url).send({ standardIds: [] })).status).toBe(409)
    expect(drafts).not.toHaveBeenCalled()
  })

  it('reports an S4 failure as a 503 and keeps the earlier checklist', async () => {
    await assessment()
    await api.post(url).send({ standardIds: [] })
    drafts.mockImplementation(() =>
      json({ detail: 'The language model could not be reached.' }, 502),
    )

    const response = await api.post(url).send({ standardIds: [] })

    expect(response.status).toBe(503)
    expect(response.body.error).toBe('The language model could not be reached.')
    expect(await ChecklistModel.countDocuments()).toBe(1)
  })

  it('answers 404 for an unknown assessment and 400 for a body without ids', async () => {
    expect((await api.get(url)).status).toBe(404)
    await assessment()
    expect((await api.post(url).send({})).status).toBe(400)
  })
})
