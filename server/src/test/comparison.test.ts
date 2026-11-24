// Comparing an assessment with the previous report for the same site (RV-13)
// through the HTTP routes: which reports it can be compared with, what S4 is
// sent and how its suggestions are settled, the engineer's decisions, keeping
// up to date, who may do what, failures, and that the report never changes.
// rag-service is a stubbed fetch.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { ObservationModel, type CopeDimension, type Severity } from '../models/observation.model'
import { ReportComparisonModel } from '../models/report-comparison.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel, type UserRole } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const person = (name: string, role: UserRole = 'risk_engineer') => ({
  _id: new Types.ObjectId(),
  staffId: name,
  name,
  email: `${name.replace(' ', '.')}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = person('Alex Rowe')
const jide = person('Jide Okafor')
const sana = person('Sana Patel', 'knowledge_admin')
const asAlex = signedInAs(app, alex)
const asJide = signedInAs(app, jide)
const asSana = signedInAs(app, sana)

const CURRENT = 'RPT-2026-0801'
const PREVIOUS = 'RPT-2025-0410'
const OLDER = 'RPT-2024-0122'
const base = `/api/assessments/${CURRENT}/comparison`
const PUMP_ROOM = new Types.ObjectId()

const TEMPLATE = [
  {
    id: '9',
    title: 'Fire Protection',
    cope_dimensions: ['Protection'],
    min_observations: 1,
    subsections: [{ heading: 'Water Supply Details', kind: 'narrative' }],
  },
]

type Suggested = Record<string, unknown>
let answer: (body: Record<string, unknown>) => { status: number; body: object }
let sent: Record<string, unknown>[] = []

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const suggestion = (previous: string, outcome: string, sources: string[] = [], extra = {}) => ({
  previous,
  outcome,
  sources,
  match: 'clear',
  disagree: [],
  possible: [],
  reason: outcome === 'not_checked' ? null : 'What the current evidence shows.',
  missing: outcome === 'not_checked' ? 'No observation records the fire pump test.' : null,
  figures: [],
  omitted: false,
  ...extra,
})
const s4 = (items: Suggested[]) => ({
  status: 200,
  body: {
    items,
    dropped: 0,
    dropped_reasons: [],
    provenance: {
      provider: 'anthropic',
      model: 'claude-test',
      effort: 'medium',
      prompt_version: 'rv13-v1',
      privacy: { enabled: false, masked_count: 0 },
    },
    usage: [
      {
        feature: 'report_comparison',
        billed_service: 'anthropic',
        model: 'claude-test',
        duration_ms: 10,
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: null,
        search_units: null,
        audio_seconds: null,
        usage_status: 'recorded',
      },
    ],
  },
})

beforeEach(async () => {
  await UserModel.create([alex, jide, sana])
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    if (path === '/sections') return json({ sections: TEMPLATE })
    if (path !== '/comparison/compare') throw new Error(`Unexpected call to ${url}`)
    const body = JSON.parse(String(init!.body))
    sent.push(body)
    const reply = answer(body)
    return json(reply.body, reply.status)
  })
})
afterEach(() => vi.unstubAllGlobals())

// ---- Records -----------------------------------------------------------------

// Generic, so each model sees the literal category it allows ('Protection', 'all').
const metadata = <Cope extends string>(cope: Cope) => ({
  jurisdiction: 'SG',
  facility_type: 'Warehouse',
  COPE_dimension: cope,
  effective_date: new Date(),
})

async function visit(
  site: Types.ObjectId,
  reference: string,
  day: string,
  extra: Record<string, unknown> = {},
) {
  return AssessmentModel.create({
    reference,
    site,
    surveyType: 'Resurvey',
    siteVisitDate: new Date(day),
    engineer: alex._id,
    locations: [{ _id: PUMP_ROOM, name: 'Pump room', floor: 'B1', key: 'pump room|b1' }],
    ...extra,
  })
}

async function observe(
  assessment: Types.ObjectId,
  note: string,
  severity: Severity,
  categories: CopeDimension[] = ['Protection'],
) {
  return ObservationModel.create({
    assessment,
    session: new Types.ObjectId(),
    engineer: alex.name,
    note,
    recordings: [],
    severity,
    location: PUMP_ROOM,
    metadata: { source_type: 'observation', ...metadata(''), COPE_dimension: categories },
  })
}

// Section 9 of a report: one finding per statement, each citing its observation,
// which its evidence holds as it was drafted.
type Observed = { _id: Types.ObjectId; note?: string; severity?: Severity | null }
async function sectionNine(
  assessment: Types.ObjectId,
  statements: { text: string; observation: Observed }[],
) {
  return ReportSectionModel.create({
    assessment,
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Water Supply Details',
        kind: 'narrative',
        statements: statements.map((s) => ({
          text: s.text,
          citations: [`O:${s.observation._id}`],
          supported: true,
        })),
      },
    ],
    sources: {},
    evidence: statements.map((s) => ({
      id: String(s.observation._id),
      COPE_dimension: ['Protection'],
      note: s.observation.note ?? '',
      transcripts: [],
      severity: s.observation.severity ?? undefined,
      location: 'Pump room, B1',
    })),
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.4',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: new Date(),
    },
    createdBy: alex._id,
    metadata: { source_type: 'report_section', ...metadata('Protection') },
  })
}

function ofi(assessment: Types.ObjectId, title: string, description: string, priority: string) {
  return ReportOfiModel.create({
    assessment,
    state: 'accepted',
    acceptedAt: new Date(),
    acceptedBy: alex._id,
    title,
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description,
    observation: 'Valves were found unsecured.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Capital',
    priority,
    observations: [],
    standards: [],
    precedent: null,
    sources: {},
    provenance: {
      provider: 'anthropic',
      model: 'm',
      effort: 'high',
      prompt_version: 'gn05-v1',
      config_version: 'c1',
      generated_at: new Date(),
    },
    createdBy: alex._id,
    metadata: { source_type: 'ofi', ...metadata('all') },
  })
}

// The site with a finalised previous report (two findings and an OFI) and the
// current assessment with two observations.
async function seed() {
  const site = await SiteModel.create({
    code: 'SITE-0801',
    name: 'Tuas Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const before = await visit(site._id, PREVIOUS, '2025-04-10', { reportStatus: 'finalised' })
  const pumpThen = await observe(before._id, 'Fire pump churn pressure 7.5 bar.', 'high')
  const valveThen = await observe(before._id, 'Sprinkler valve chained but unlocked.', 'moderate')
  await sectionNine(before._id, [
    { text: 'The fire pump churn pressure was 7.5 bar at the weekly test.', observation: pumpThen },
    { text: 'The sprinkler control valve was chained but not locked.', observation: valveThen },
  ])
  await ofi(
    before._id,
    'Lock Sprinkler Control Valves',
    'Lock every control valve open.',
    'Priority 2',
  )
  const now = await visit(site._id, CURRENT, '2026-08-01')
  const pump = await observe(
    now._id,
    'Fire pump churn pressure 6.9 bar at the weekly test.',
    'critical',
  )
  const fresh = await observe(now._id, 'Roller shutter in the fire wall jammed open.', 'high')
  return { site, before, now, pump, fresh }
}

const O = (o: { _id: Types.ObjectId }) => `O:${o._id}`

// ---- Finding the previous report --------------------------------------------

describe('Finding the previous report', () => {
  it('names the latest earlier finalised report of the site, and lists the others', async () => {
    const { site } = await seed()
    await visit(site._id, OLDER, '2024-01-22', { reportStatus: 'finalised', engineer: jide._id })
    // Not finalised, archived, later, or at another site: never offered.
    await visit(site._id, 'RPT-2025-0900', '2025-09-01', { reportStatus: 'under_review' })
    await visit(site._id, 'RPT-2025-1000', '2025-10-01', {
      reportStatus: 'finalised',
      archivedAt: new Date(),
    })
    await visit(site._id, 'RPT-2026-1201', '2026-12-01', { reportStatus: 'finalised' })
    await visit(new Types.ObjectId(), 'RPT-2025-0500', '2025-05-01', { reportStatus: 'finalised' })

    const response = await asAlex.get(base)

    expect(response.status).toBe(200)
    expect(response.body.previous).toEqual({
      reference: PREVIOUS,
      siteVisitDate: '2025-04-10T00:00:00.000Z',
      engineer: 'Alex Rowe',
    })
    expect(response.body.previousReports.map((r: { reference: string }) => r.reference)).toEqual([
      PREVIOUS,
      OLDER,
    ])
    expect(response.body.previousReports[1].engineer).toBe('Jide Okafor')
    expect(response.body.comparison).toBeNull()
    expect(response.body.canChange).toBe(true)
    expect(response.body.observations).toBe(2)
  })

  it('says when the site has no earlier finalised report', async () => {
    const site = await SiteModel.create({
      code: 'SITE-0802',
      name: 'Jurong',
      jurisdiction: 'SG',
      facilityType: 'Warehouse',
    })
    await visit(site._id, CURRENT, '2026-08-01')

    const response = await asAlex.get(base)

    expect(response.status).toBe(200)
    expect(response.body.previousReports).toEqual([])
    expect(response.body.previous).toBeNull()
  })

  it('refuses a report that is not an earlier finalised report of the site', async () => {
    await seed()

    expect((await asAlex.get(`${base}?previous=RPT-1999-0001`)).status).toBe(404)
    expect((await asAlex.post(base).send({ previous: 'RPT-1999-0001' })).status).toBe(404)
  })
})

// ---- Running ------------------------------------------------------------------

describe('Compare with previous report', () => {
  it('sends the previous report as it reads and the current evidence, and settles each outcome', async () => {
    const { pump, fresh } = await seed()
    answer = () =>
      s4([
        // A severity rise is Worse whatever the model said, with the figure worked out in code.
        suggestion('P1', 'unchanged', ['O1'], {
          figures: [
            { name: 'Churn pressure', previous: '7.5 bar', current: '6.9 bar', source: 'O1' },
          ],
        }),
        // Fixed with nothing current behind it is Not checked.
        suggestion('P2', 'fixed'),
        suggestion('P3', 'not_checked'),
      ])

    const response = await asAlex.post(base).send({ previous: PREVIOUS })

    expect(response.status).toBe(201)
    const [request] = sent
    expect(request.previous).toEqual([
      expect.objectContaining({
        label: 'P1',
        kind: 'finding',
        section: '9. Fire Protection',
        title: 'Water Supply Details',
        text: 'The fire pump churn pressure was 7.5 bar at the weekly test.',
        severity: 'high',
      }),
      expect.objectContaining({ label: 'P2', severity: 'moderate' }),
      expect.objectContaining({
        label: 'P3',
        kind: 'recommendation',
        section: '3. Opportunities for Improvement',
        priority: 'Priority 2',
      }),
    ])
    expect(request.current).toEqual([
      expect.objectContaining({ label: 'O1', kind: 'observation', severity: 'critical' }),
      expect.objectContaining({ label: 'O2', kind: 'observation' }),
    ])
    const { comparison } = response.body
    const byKey = Object.fromEntries(
      comparison.items.map((i: { key: string }) => [i.key, i]),
    ) as Record<string, Record<string, unknown>>
    const first = byKey['P:9:0.0']
    // The tab reads the comparison's outcome after the rules; the model's own answer is kept.
    expect(first).toMatchObject({
      outcome: 'worse',
      suggested: 'worse',
      corrections: ['severity'],
      sources: [O(pump)],
      severity: { previous: 'High', current: 'Critical', direction: 1 },
      confidence: 'low',
      decided: null,
    })
    expect(first.previous).toMatchObject({
      quote: 'The fire pump churn pressure was 7.5 bar at the weekly test.',
      section: '9. Fire Protection',
    })
    expect(first.figures).toEqual([
      {
        name: 'Churn pressure',
        previous: '7.5 bar',
        current: '6.9 bar',
        source: O(pump),
        difference: '−0.6 bar',
        note: null,
      },
    ])
    const saved = await ReportComparisonModel.findOne().lean()
    expect(saved!.items.find((i) => i.key === 'P:9:0.0')).toMatchObject({
      outcome: 'worse',
      suggested: 'unchanged',
    })
    expect(byKey['P:9:0.1']).toMatchObject({ outcome: 'not_checked', sources: [] })
    expect(byKey['P:9:0.1'].missing).toMatch(/^No observation, draft finding or draft OFI/)
    expect(byKey[`N:${O(fresh)}`]).toMatchObject({ kind: 'new', outcome: 'new' })
    // Worse first, then New at High, then Not checked.
    expect(comparison.items.map((i: { key: string }) => i.key)).toEqual([
      'P:9:0.0',
      `N:${O(fresh)}`,
      'P:9:0.1',
      expect.stringMatching(/^P:3:/),
    ])
    expect(comparison.summary).toBe('1 worse, 1 new, 2 not checked')
    expect(comparison.outOfDate).toBeNull()
    expect(
      await AiCallModel.countDocuments({ feature: 'report-comparison', reportId: CURRENT }),
    ).toBe(1)
  })

  it('leaves the outcome to the engineer when current sources disagree', async () => {
    const { pump, fresh } = await seed()
    answer = () =>
      s4([
        suggestion('P1', 'fixed', ['O1', 'O2'], { disagree: ['O1', 'O2'] }),
        suggestion('P2', 'not_checked'),
        suggestion('P3', 'not_checked'),
      ])

    const response = await asAlex.post(base).send({ previous: PREVIOUS })

    const item = response.body.comparison.items.find((i: { key: string }) => i.key === 'P:9:0.0')
    expect(item).toMatchObject({
      outcome: null,
      disagree: [O(pump), O(fresh)],
      confidence: 'medium',
    })
    expect(response.body.comparison.summary).toContain('1 to decide')
    // Accepting needs an outcome first.
    const accept = await asAlex
      .post(
        `${base}/${response.body.comparison.id}/items/${encodeURIComponent('P:9:0.0')}/decision`,
      )
      .send({ action: 'accept' })
    expect(accept.status).toBe(400)
  })

  it('needs a saved observation', async () => {
    const { now } = await seed()
    await ObservationModel.deleteMany({ assessment: now._id })

    const response = await asAlex.post(base).send({ previous: PREVIOUS })

    expect(response.status).toBe(409)
    expect(sent).toEqual([])
  })

  it('keeps the last comparison and says why and when a run failed', async () => {
    await seed()
    answer = () =>
      s4([
        suggestion('P1', 'not_checked'),
        suggestion('P2', 'not_checked'),
        suggestion('P3', 'not_checked'),
      ])
    const first = await asAlex.post(base).send({ previous: PREVIOUS })
    answer = () => ({ status: 502, body: { detail: 'The language model could not be reached.' } })

    const failed = await asAlex.post(base).send({ previous: PREVIOUS })

    expect(failed.status).toBe(503)
    expect(failed.body.error).toBe('The language model could not be reached.')
    expect(failed.body.failedAt).toBeTruthy()
    const page = await asAlex.get(base)
    expect(page.body.comparison.id).toBe(first.body.comparison.id)
    expect(page.body.failure).toEqual({
      error: 'The language model could not be reached.',
      at: failed.body.failedAt,
    })
  })
})

// ---- Deciding and keeping current -------------------------------------------

describe('The engineer decides each outcome', () => {
  async function compared() {
    const records = await seed()
    answer = () =>
      s4([
        suggestion('P1', 'worse', ['O1']),
        suggestion('P2', 'not_checked'),
        suggestion('P3', 'not_checked'),
      ])
    const response = await asAlex.post(base).send({ previous: PREVIOUS })
    const id = response.body.comparison.id as string
    const decide = (item: string, body: object) =>
      asAlex.post(`${base}/${id}/items/${encodeURIComponent(item)}/decision`).send(body)
    return { ...records, id, decide }
  }

  it('saves each decision with the name and time, and updates the counts', async () => {
    const { decide } = await compared()

    const accepted = await decide('P:9:0.0', { action: 'accept' })

    expect(accepted.status).toBe(200)
    const item = accepted.body.comparison.items.find((i: { key: string }) => i.key === 'P:9:0.0')
    expect(item.decided).toMatchObject({ action: 'accept', by: { name: 'Alex Rowe' } })
    expect(item.decided.at).toBeTruthy()

    // Fixed with no current source needs a short note.
    const bare = await decide('P:9:0.1', { action: 'outcome', outcome: 'fixed' })
    expect(bare.status).toBe(400)
    expect(bare.body.fields.note).toBeTruthy()
    const noted = await decide('P:9:0.1', {
      action: 'outcome',
      outcome: 'fixed',
      note: 'Seen locked on the walk with the facility manager.',
    })
    expect(noted.status).toBe(200)
    expect(noted.body.comparison.summary).toBe('1 fixed, 1 worse, 1 new, 1 not checked')

    const dismissed = await decide(
      `N:${noted.body.comparison.items.find((i: { kind: string }) => i.kind === 'new').source}`,
      {
        action: 'dismiss',
      },
    )
    expect(dismissed.body.comparison.counts).toMatchObject({ new: 0, dismissed: 1 })
  })

  it('re-pairs an item with other current evidence, and unpairs it', async () => {
    const { decide, fresh } = await compared()

    const paired = await decide('P:9:0.1', {
      action: 'pair',
      sources: [O(fresh)],
      outcome: 'unchanged',
    })

    const items = paired.body.comparison.items
    expect(items.find((i: { key: string }) => i.key === 'P:9:0.1')).toMatchObject({
      outcome: 'unchanged',
      sources: [O(fresh)],
    })
    // Paired now, so no longer New.
    expect(items.some((i: { kind: string }) => i.kind === 'new')).toBe(false)

    const unpaired = await decide('P:9:0.1', { action: 'unpair' })
    expect(
      unpaired.body.comparison.items.find((i: { key: string }) => i.key === 'P:9:0.1'),
    ).toMatchObject({ outcome: 'not_checked', sources: [] })
  })

  it('says what changed since it ran, and Compare again keeps decisions on unchanged items', async () => {
    const { decide, now, pump } = await compared()
    await decide('P:9:0.0', { action: 'accept' })
    await decide('P:9:0.1', { action: 'outcome', outcome: 'fixed', note: 'Seen locked.' })
    await observe(now._id, 'Hose reel cabinet blocked by pallets.', 'moderate')
    await ObservationModel.updateOne({ _id: pump._id }, { severity: 'high' })

    const page = await asAlex.get(base)

    expect(page.body.comparison.outOfDate.summary).toBe('1 observation added and 1 retagged')
    expect(page.body.comparison.outOfDate.changes).toHaveLength(2)

    const again = await asAlex.post(base).send({ previous: PREVIOUS })
    const items = again.body.comparison.items
    // P2 rested on nothing that changed: kept, as decided then.
    expect(items.find((i: { key: string }) => i.key === 'P:9:0.1')).toMatchObject({
      outcome: 'fixed',
      decided: { by: { name: 'Alex Rowe' }, carried: true },
      recheck: null,
    })
    // P1's observation was retagged: flagged for another look, its decision not kept.
    const flagged = items.find((i: { key: string }) => i.key === 'P:9:0.0')
    expect(flagged.decided).toBeNull()
    expect(flagged.recheck).toMatch(/before its evidence changed/)
    expect(again.body.comparison.outOfDate).toBeNull()
  })

  it('refuses a decision on an older comparison', async () => {
    const { id } = await compared()
    await asAlex.post(base).send({ previous: PREVIOUS })

    const response = await asAlex
      .post(`${base}/${id}/items/${encodeURIComponent('P:9:0.0')}/decision`)
      .send({ action: 'accept' })

    expect(response.status).toBe(409)
  })
})

// ---- Access and the report ----------------------------------------------------

describe('Who may compare, and the report stays as it is', () => {
  it('lets a knowledge admin read but not change it, and refuses other engineers', async () => {
    await seed()
    answer = () =>
      s4([
        suggestion('P1', 'not_checked'),
        suggestion('P2', 'not_checked'),
        suggestion('P3', 'not_checked'),
      ])
    const run = await asAlex.post(base).send({ previous: PREVIOUS })

    const admin = await asSana.get(base)
    expect(admin.status).toBe(200)
    expect(admin.body).toMatchObject({ canChange: false, readOnly: 'not_assigned' })
    expect((await asSana.post(base).send({ previous: PREVIOUS })).status).toBe(403)
    expect(
      (
        await asSana
          .post(`${base}/${run.body.comparison.id}/items/${encodeURIComponent('P:9:0.0')}/decision`)
          .send({ action: 'accept' })
      ).status,
    ).toBe(403)

    expect((await asJide.get(base)).status).toBe(403)
    expect((await asJide.post(base).send({ previous: PREVIOUS })).status).toBe(403)
  })

  it('is read only on an archived assessment', async () => {
    const { now } = await seed()
    await AssessmentModel.updateOne({ _id: now._id }, { archivedAt: new Date() })

    const page = await asAlex.get(base)

    expect(page.body).toMatchObject({ canChange: false, readOnly: 'archived' })
    expect((await asAlex.post(base).send({ previous: PREVIOUS })).status).toBe(409)
  })

  it('changes no section, version, review log entry or finding', async () => {
    const { decide } = await (async () => {
      await seed()
      answer = () =>
        s4([
          suggestion('P1', 'worse', ['O1']),
          suggestion('P2', 'not_checked'),
          suggestion('P3', 'not_checked'),
        ])
      const response = await asAlex.post(base).send({ previous: PREVIOUS })
      return {
        decide: (item: string, body: object) =>
          asAlex
            .post(
              `${base}/${response.body.comparison.id}/items/${encodeURIComponent(item)}/decision`,
            )
            .send(body),
      }
    })()
    const before = await Promise.all([
      ReportSectionModel.find().lean(),
      ReportSectionVersionModel.countDocuments(),
      ReviewAuditModel.countDocuments(),
      ReportOfiModel.find().lean(),
      AssessmentModel.find({}, 'reportStatus stage').lean(),
    ])

    await decide('P:9:0.0', { action: 'accept' })
    await decide('P:9:0.1', { action: 'outcome', outcome: 'fixed', note: 'Seen locked.' })

    const after = await Promise.all([
      ReportSectionModel.find().lean(),
      ReportSectionVersionModel.countDocuments(),
      ReviewAuditModel.countDocuments(),
      ReportOfiModel.find().lean(),
      AssessmentModel.find({}, 'reportStatus stage').lean(),
    ])
    expect(after).toEqual(before)
    expect(await ReportComparisonModel.countDocuments()).toBe(1)
  })
})
