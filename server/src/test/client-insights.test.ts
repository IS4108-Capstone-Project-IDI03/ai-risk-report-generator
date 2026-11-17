// A client's Insights tab (CP-29) through the HTTP routes: what is counted and
// from which assessment, how sites are ordered and worded, who sees what, and
// the written summary (rag-service is a stubbed fetch).
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ClientInsightSummaryModel } from '../models/client-insight-summary.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { UserModel } from '../models/user.model'
import { RQR_CATEGORIES } from '../services/risk-quality.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { oneAssessment } from './new-assessments'

useMemoryMongo()

const account = (name: string, staffId: string, role: 'risk_engineer' | 'knowledge_admin') => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId.toLowerCase()}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = account('Alex Rowe', 'TEST-1', 'risk_engineer')
const jide = account('Jide Okafor', 'TEST-2', 'risk_engineer')
const sana = account('Sana Patel', 'TEST-3', 'knowledge_admin')
const api = signedInAs(app, alex)
const jideApi = signedInAs(app, jide)
const adminApi = signedInAs(app, sana)
type Api = typeof api

type RagAnswer = { status: number; body: object }
const rag = vi.fn<(body: Record<string, unknown>) => RagAnswer>()

beforeEach(async () => {
  await UserModel.create([alex, jide, sana])
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!url.endsWith('/client-insights/summary')) throw new Error(`Unexpected call to ${url}`)
    const answer = rag(JSON.parse(String(init.body)))
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
})
afterEach(() => {
  rag.mockReset()
  vi.unstubAllGlobals()
  config.piiProtection = 'off'
})

const site = (name: string) => ({
  name,
  address: `${name} Road`,
  jurisdiction: 'SG',
  facilityType: 'Mixed-use development',
})

// One assessment, at a new site of a new client unless ids are given.
async function visit(
  as: Api,
  payload: Record<string, unknown>,
): Promise<{ reference: string; clientId: string; siteId: string; id: Types.ObjectId }> {
  const response = await as
    .post('/api/assessments')
    .send(oneAssessment({ client: 'Northgate Logistics', ...payload }))
  expect(response.status).toBe(201)
  const made = response.body.assessments[0]
  const stored = await AssessmentModel.findOne({ reference: made.reference }, '_id').lean()
  return {
    reference: made.reference,
    clientId: made.clientId,
    siteId: made.site.id,
    id: stored!._id,
  }
}

function observe(
  assessment: Types.ObjectId,
  severity: 'critical' | 'high' | 'moderate' | 'low',
  categories: CopeDimension[] | null,
  note = 'Sprinkler valve found shut.',
  extra: Record<string, unknown> = {},
) {
  return ObservationModel.create({
    assessment,
    session: new Types.ObjectId(),
    engineer: alex.name,
    note,
    recordings: [],
    severity,
    location: new Types.ObjectId(),
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Mixed-use development',
      COPE_dimension: categories,
      effective_date: new Date(),
    },
    ...extra,
  })
}

function ofi(
  assessment: Types.ObjectId,
  priority: string,
  state: 'accepted' | 'suggested' = 'accepted',
) {
  return ReportOfiModel.create({
    assessment,
    state,
    acceptedAt: new Date(),
    acceptedBy: alex._id,
    title: 'Lock Sprinkler Control Valves Open',
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description: 'Lock valves open.',
    observation: 'A valve was shut.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Capital',
    priority,
    observations: [],
    standards: [],
    precedent: null,
    provenance: {
      provider: 'anthropic',
      model: 'm',
      effort: 'high',
      prompt_version: 'gn05-v1',
      config_version: 'c1',
      generated_at: new Date(),
    },
    createdBy: alex._id,
    metadata: {
      source_type: 'ofi',
      jurisdiction: 'SG',
      facility_type: 'Mixed-use development',
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
}

// Section 4's seven scores, all `current` (out of 10), or all but one.
function scores(assessment: Types.ObjectId, current: number, complete = true) {
  return AssessmentModel.updateOne(
    { _id: assessment },
    {
      riskQuality: {
        categories: RQR_CATEGORIES.map((category, i) => ({
          category,
          current: complete || i ? current : null,
          potential: 9,
        })),
        updatedAt: new Date(),
        updatedBy: alex._id,
      },
    },
  )
}

// Two sites: Tilbury visited twice (it got worse), Leeds once.
async function northgate() {
  const first = await visit(api, { site: site('Tilbury'), siteVisitDate: '2025-03-10' })
  await observe(first.id, 'high', ['Protection'])
  await observe(first.id, 'low', ['Occupancy'])
  const second = await visit(api, {
    clientId: first.clientId,
    siteId: first.siteId,
    surveyType: 'Resurvey',
    siteVisitDate: '2026-03-12',
  })
  await observe(second.id, 'critical', ['Protection'], 'In-rack sprinkler valve found closed.')
  await observe(second.id, 'high', ['Construction', 'Protection'])
  await observe(second.id, 'moderate', null)
  await observe(second.id, 'critical', ['Exposure'], 'Deleted by mistake.', {
    deleted: { at: new Date(), by: { id: String(alex._id), name: alex.name } },
  })
  await ofi(second.id, 'Priority 1')
  await ofi(second.id, 'Priority 1', 'suggested')
  const leeds = await visit(api, {
    clientId: first.clientId,
    site: site('Leeds'),
    siteVisitDate: '2026-05-01',
  })
  await observe(leeds.id, 'high', ['Protection'])
  await observe(leeds.id, 'low', ['Occupancy'])
  await observe(leeds.id, 'low', ['Occupancy'])
  return { clientId: first.clientId, first, second, leeds }
}

const insights = (as: Api, clientId: string) => as.get(`/api/clients/${clientId}/insights`)

describe('Counting (CP-29)', () => {
  it("counts each site's latest assessment, leaving out deleted observations and suggested OFIs", async () => {
    const { clientId, second, leeds } = await northgate()

    const { status, body } = await insights(api, clientId)

    expect(status).toBe(200)
    expect(body.empty).toBe(false)
    expect(body.totals).toMatchObject({
      sites: 2,
      assessments: 3,
      observations: 6,
      uncategorised: 1,
      critical: 1,
      high: 2,
      ofisAccepted: 1,
      ofisPriority12: 1,
      reportsLate: 0,
      latest: null,
    })
    // Worst first: Tilbury has the Critical finding.
    expect(body.sites.map((s: { name: string }) => s.name)).toEqual(['Tilbury', 'Leeds'])
    const [tilbury, leedsSite] = body.sites
    expect(tilbury).toMatchObject({
      reference: second.reference,
      observations: 3,
      critical: 1,
      high: 1,
      uncategorised: 1,
      ofis: { accepted: 1, priority1: 1, priority2: 0 },
      rating: null,
      change: 'worse',
    })
    expect(leedsSite).toMatchObject({ reference: leeds.reference, observations: 3, change: null })
    // An observation filed under two categories counts in both.
    expect(tilbury.cells).toEqual([
      { category: 'Construction', count: 1, critical: 0, high: 1 },
      { category: 'Occupancy', count: 0, critical: 0, high: 0 },
      { category: 'Protection', count: 2, critical: 1, high: 1 },
      { category: 'Exposure', count: 0, critical: 0, high: 0 },
      { category: null, count: 1, critical: 0, high: 0 },
    ])
    expect(body.byCategory.map((c: { count: number }) => c.count)).toEqual([1, 2, 3, 0, 1])
  })

  it('says why each site sits where it does', async () => {
    const { clientId } = await northgate()

    const { body } = await insights(api, clientId)

    expect(body.sites[0].reasons).toEqual([
      { text: '1 Critical finding', tone: 'danger' },
      { text: '1 Priority 1 OFI', tone: 'danger' },
      { text: '1 High finding', tone: 'warn' },
      { text: '1 uncategorised', tone: 'warn' },
      { text: 'Rating not entered', tone: 'neutral' },
      { text: 'Worse since first visit', tone: 'warn' },
    ])
  })

  it('keeps a site on its last findings while a later visit has none yet', async () => {
    const { clientId, first, second } = await northgate()
    await visit(api, {
      clientId,
      siteId: first.siteId,
      surveyType: 'Follow-up visit',
      siteVisitDate: '2026-12-01',
    })

    const { body } = await insights(api, clientId)

    const tilbury = body.sites.find((s: { name: string }) => s.name === 'Tilbury')
    expect(tilbury).toMatchObject({ reference: second.reference, observations: 3 })
    expect(tilbury.visits).toHaveLength(2)
    expect(body.totals.assessments).toBe(4)
  })

  it('rates a site only once all seven scores are entered', async () => {
    const { clientId, second, leeds } = await northgate()
    await scores(second.id, 4.9)
    await scores(leeds.id, 8, false)

    const { body } = await insights(api, clientId)

    const [tilbury, leedsSite] = body.sites
    expect(tilbury.rating).toEqual({ score: 49, rating: 'D' })
    expect(tilbury.reasons).toContainEqual({ text: 'Rated D', tone: 'warn' })
    expect(leedsSite.rating).toBeNull()
    expect(leedsSite.reasons).toContainEqual({ text: 'Rating not entered', tone: 'neutral' })
  })

  it('counts a report past its due day as late', async () => {
    const made = await visit(api, {
      site: site('Tilbury'),
      siteVisitDate: '2019-12-01',
      reportDueDate: '2020-01-01',
    })
    await observe(made.id, 'low', ['Occupancy'])

    const { body } = await insights(api, made.clientId)

    expect(body.totals.reportsLate).toBe(1)
    expect(body.totals.latest.site).toBe('Tilbury')
    expect(body.sites[0].reasons[0]).toMatchObject({ tone: 'danger' })
    expect(body.sites[0].reasons[0].text).toMatch(/^Report \d+ days late$/)
  })

  it('leaves out archived assessments and removed sites', async () => {
    const { clientId, leeds } = await northgate()
    expect((await api.post(`/api/assessments/${leeds.reference}/archive`)).status).toBe(204)

    const archived = await insights(api, clientId)
    expect(archived.body.sites.map((s: { name: string }) => s.name)).toEqual(['Tilbury'])
    expect(archived.body.totals.observations).toBe(3)

    expect((await api.post(`/api/sites/${leeds.siteId}/remove`)).status).toBe(204)
    const removed = await insights(api, clientId)
    expect(removed.body.totals.sites).toBe(1)
  })

  it('says there is nothing to analyse before any observation', async () => {
    const made = await visit(api, { site: site('Tilbury'), siteVisitDate: '2026-03-10' })

    const { body } = await insights(api, made.clientId)

    expect(body).toMatchObject({ empty: true, findings: [], canSummarise: false, summary: null })
    expect(body.sites[0].reasons).toEqual([{ text: 'No observations yet', tone: 'neutral' }])
  })
})

describe('What stands out (CP-29)', () => {
  it('names the most common category and the site that got worse', async () => {
    const { clientId, first } = await northgate()

    const { body } = await insights(api, clientId)

    expect(body.findings).toEqual([
      {
        kind: 'category',
        tone: 'neutral',
        title: 'Protection is the most common category',
        detail: '3 of 6 observations, found at all 2 sites.',
        siteId: null,
        category: 'Protection',
        share: { count: 3, total: 6 },
        change: null,
      },
      {
        kind: 'worse',
        tone: 'danger',
        title: 'Tilbury got worse between visits',
        detail: 'Critical and High findings rose from 1 to 2.',
        siteId: first.siteId,
        category: null,
        share: null,
        change: { from: 1, to: 2, period: 'Mar 2025 to Mar 2026' },
      },
    ])
  })

  it('names a site that improved, with how its rating moved', async () => {
    const first = await visit(api, { site: site('Leeds'), siteVisitDate: '2025-06-04' })
    await observe(first.id, 'critical', ['Protection'])
    await observe(first.id, 'high', ['Protection'])
    await scores(first.id, 5.5)
    const second = await visit(api, {
      clientId: first.clientId,
      siteId: first.siteId,
      surveyType: 'Resurvey',
      siteVisitDate: '2026-10-22',
    })
    await observe(second.id, 'high', ['Protection'])
    await scores(second.id, 7.2)

    const { body } = await insights(api, first.clientId)

    // Three observations in all: too few to call a category the most common.
    expect(body.findings).toHaveLength(1)
    expect(body.findings[0]).toMatchObject({
      kind: 'improved',
      tone: 'good',
      title: 'Leeds improved between visits',
      detail: 'Critical and High findings fell from 2 to 1, and its rating rose from C to B.',
    })
    expect(body.sites[0].change).toBe('improved')
  })

  it('names no most common category on a tie', async () => {
    const made = await visit(api, { site: site('Tilbury'), siteVisitDate: '2026-03-10' })
    for (const category of ['Protection', 'Protection', 'Protection', 'Occupancy'] as const)
      await observe(made.id, 'low', [category])
    await observe(made.id, 'low', ['Occupancy'])
    await observe(made.id, 'low', ['Occupancy'])

    const { body } = await insights(api, made.clientId)

    expect(body.findings).toEqual([])
  })
})

describe('Who sees what (CP-29)', () => {
  it("counts only the engineer's own assessments, and every one for a knowledge admin", async () => {
    const { clientId } = await northgate()
    const theirs = await visit(jideApi, {
      clientId,
      site: site('Grays'),
      siteVisitDate: '2026-06-01',
    })
    await observe(theirs.id, 'critical', ['Exposure'])

    const mine = await insights(api, clientId)
    expect(mine.body.sites.map((s: { name: string }) => s.name)).toEqual(['Tilbury', 'Leeds'])
    expect(mine.body.totals.critical).toBe(1)

    const jides = await insights(jideApi, clientId)
    expect(jides.body.sites.map((s: { name: string }) => s.name)).toEqual(['Grays'])

    const admins = await insights(adminApi, clientId)
    expect(admins.body.totals).toMatchObject({ sites: 3, critical: 2 })
  })

  it('refuses an engineer with no assessment for the client, and an unknown client', async () => {
    const { clientId } = await northgate()

    expect((await insights(jideApi, clientId)).status).toBe(403)
    expect((await insights(api, String(new Types.ObjectId()))).status).toBe(404)
    expect((await jideApi.post(`/api/clients/${clientId}/insights/summary`)).status).toBe(403)
  })
})

describe('The written summary (CP-29)', () => {
  const answer = (statements: { text: string; citations: string[] }[]): RagAnswer => ({
    status: 200,
    body: {
      statements,
      missing: 'Leeds has no rating yet.',
      confidence: 'medium',
      dropped: 0,
      provenance: {
        provider: 'anthropic',
        model: 'claude-test',
        effort: 'medium',
        prompt_version: 'cp29-v1',
        privacy: { enabled: false, masked_count: 0 },
      },
      usage: [
        {
          feature: 'client-insights',
          billed_service: 'anthropic',
          model: 'claude-test',
          duration_ms: 900,
          input_tokens: 1200,
          output_tokens: 150,
          usage_status: 'recorded',
        },
      ],
    },
  })
  const written = answer([
    { text: 'Protection findings dominate across both sites.', citations: ['F1'] },
    { text: 'Tilbury has a closed in-rack sprinkler valve.', citations: ['O1', 'F1'] },
  ])
  const write = (as: Api, clientId: string) => as.post(`/api/clients/${clientId}/insights/summary`)

  it('sends the figures and observations, and keeps the statements with their sources', async () => {
    const { clientId, second } = await northgate()
    rag.mockReturnValue(written)

    const { status, body } = await write(api, clientId)

    expect(status).toBe(201)
    const sent = rag.mock.calls[0][0] as {
      client: string
      figures: { label: string; lines: string[] }[]
      observations: { label: string; site: string; severity: string; text: string }[]
      privacy: { enabled: boolean }
    }
    expect(sent.client).toBe('Northgate Logistics')
    expect(sent.figures.map((f) => f.label)).toEqual(['F1', 'F2', 'F3'])
    expect(sent.figures[0].lines[0]).toBe(
      'Across 2 sites: Construction 1, Occupancy 2, Protection 3, Exposure 0, uncategorised 1 (6 observations).',
    )
    expect(sent.figures[2].lines).toEqual([
      'Tilbury: Critical and High findings 1 (Mar 2025) to 2 (Mar 2026).',
    ])
    // Most severe first; the deleted observation and the earlier visit's are not sent.
    expect(sent.observations).toHaveLength(6)
    expect(sent.observations[0]).toMatchObject({
      label: 'O1',
      site: 'Tilbury',
      severity: 'critical',
      text: 'In-rack sprinkler valve found closed.',
    })
    expect(sent.privacy.enabled).toBe(false)

    expect(body.statements).toEqual([
      { text: 'Protection findings dominate across both sites.', citations: [1] },
      { text: 'Tilbury has a closed in-rack sprinkler valve.', citations: [2, 1] },
    ])
    expect(body.sources).toMatchObject([
      { n: 1, kind: 'figure', observationId: null, reference: null },
      {
        n: 2,
        kind: 'observation',
        title: 'Tilbury',
        quote: 'In-rack sprinkler valve found closed.',
        reference: second.reference,
      },
    ])
    expect(body.sources[1].meta).toMatch(/^Critical · \d+ \w{3} \d{4}$/)
    expect(body).toMatchObject({
      missing: 'Leeds has no rating yet.',
      confidence: 'medium',
      basis: { observations: 6, ofis: 1, ratings: 0 },
      outOfDate: false,
    })

    const saved = await ClientInsightSummaryModel.findOne().lean()
    expect(saved!.metadata).toMatchObject({
      source_type: 'client_insight_summary',
      jurisdiction: null,
      facility_type: null,
      COPE_dimension: null,
    })
    expect(saved!.provenance).toMatchObject({
      prompt_version: 'cp29-v1',
      rules_version: 'insights-v1',
    })
    const calls = await AiCallModel.find({ feature: 'client-insights' }).lean()
    expect(calls).toHaveLength(1)
    expect(String(calls[0].userId)).toBe(String(alex._id))
  })

  it("shows the user's latest summary, out of date once the observations change", async () => {
    const { clientId, leeds } = await northgate()
    rag.mockReturnValue(written)
    await write(api, clientId)

    const before = await insights(api, clientId)
    expect(before.body.summary).toMatchObject({ outOfDate: false })
    expect(before.body.summary.statements).toHaveLength(2)
    expect(before.body.canSummarise).toBe(true)

    await observe(leeds.id, 'high', ['Construction'])
    const after = await insights(api, clientId)
    expect(after.body.summary.outOfDate).toBe(true)

    // A summary is its writer's: an admin reading the same client has none.
    expect((await insights(adminApi, clientId)).body.summary).toBeNull()
  })

  it('asks for client details to be masked when protection is on', async () => {
    const { clientId } = await northgate()
    config.piiProtection = 'required'
    rag.mockReturnValue(written)

    await write(api, clientId)

    const sent = rag.mock.calls[0][0] as {
      privacy: { enabled: boolean; known_entities: { type: string; names: string[] }[] }
    }
    expect(sent.privacy.enabled).toBe(true)
    expect(sent.privacy.known_entities).toContainEqual({
      type: 'CLIENT',
      names: ['Northgate Logistics'],
    })
  })

  it('keeps nothing when client details could not be protected', async () => {
    const { clientId } = await northgate()
    rag.mockReturnValue({
      status: 503,
      body: { detail: "Client details couldn't be protected, so nothing was sent." },
    })

    const { status, body } = await write(api, clientId)

    expect(status).toBe(503)
    expect(body.error).toBe("Client details couldn't be protected, so nothing was sent.")
    expect(await ClientInsightSummaryModel.countDocuments()).toBe(0)
  })

  it('keeps nothing when no statement cites a source it was given', async () => {
    const { clientId } = await northgate()
    rag.mockReturnValue(answer([{ text: 'Unsupported.', citations: ['O99'] }]))

    const { status, body } = await write(api, clientId)

    expect(status).toBe(503)
    expect(body.error).toMatch(/could not be checked against its sources/)
    expect(await ClientInsightSummaryModel.countDocuments()).toBe(0)
  })

  it('asks no model when there is no observation to write from', async () => {
    const made = await visit(api, { site: site('Tilbury'), siteVisitDate: '2026-03-10' })

    const { status } = await write(api, made.clientId)

    expect(status).toBe(409)
    expect(rag).not.toHaveBeenCalled()
  })
})
