// EV-01: deterministic evidence and structure checks on a drafted report.
// The rag-service is stubbed (template and chunk lookup); no paid call is made.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { EvaluationRunModel } from '../models/evaluation-run.model'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { runEvaluation } from '../services/evidence-check.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const REF = 'RPT-2026-0901'
const VERSION = 'global-pre-v2.0-2026-02'
const user = { id: String(new Types.ObjectId()), role: 'risk_engineer' as const, name: 'Alex Rowe' }
const BAY = new Types.ObjectId()

// What rag-service GET /sections answers (two sections keep the tests short).
const sub = (heading: string, kind = 'narrative') => ({ heading, kind })
const TEMPLATE = {
  template_version: VERSION,
  sections: [
    {
      id: '7',
      title: 'Construction',
      cope_dimensions: ['Construction'],
      min_observations: 1,
      subsections: [
        sub('Construction Narrative'),
        sub('Construction Table', 'table'),
        sub('Compartmentalization and Fire Divisions'),
        sub('Details on Combustible Construction'),
      ],
    },
    {
      id: '12',
      title: 'Business Interruption',
      cope_dimensions: ['Exposure'],
      min_observations: 1,
      subsections: [
        sub('Site', 'fields'),
        sub('Business Continuity / Disaster Recovery Planning', 'fields'),
      ],
    },
  ],
}

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const lookup = vi.fn<(ids: string[]) => Response>()

beforeEach(() => {
  lookup.mockImplementation(() => json({ results: [] }))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/sections')
      ? json(TEMPLATE)
      : url.endsWith('/chunks/exist')
        ? lookup(JSON.parse(String(init!.body)).ids)
        : json({ detail: 'unexpected' }, 404),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function assessment(reference = REF, engineer = user.id) {
  const site = await SiteModel.create({
    code: `S-${reference}`,
    name: 'Site',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const created = await AssessmentModel.create({
    reference,
    site: site._id,
    client: 'Northgate',
    surveyType: 'Property risk survey',
    standards: [],
    engineer,
    locations: [{ _id: BAY, name: 'Bay 3', floor: 'Ground', key: `bay 3|ground|${reference}` }],
  })
  const session = await CaptureSessionModel.create({ assessment: created._id, status: 'active' })
  return { assessment: created, session }
}

async function observation(
  ids: { assessment: Types.ObjectId; session: Types.ObjectId },
  over: Record<string, unknown> = {},
) {
  return ObservationModel.create({
    assessment: ids.assessment,
    session: ids.session,
    engineer: user.name,
    note: 'Risers not fire-stopped.',
    recordings: [],
    severity: 'high',
    location: BAY,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
    ...over,
  })
}

type Sub = {
  heading: string
  kind: 'narrative' | 'fields' | 'table'
  statements: { text: string; citations: string[]; supported: boolean }[]
}
const statement = (text: string, citations: string[] = []) => ({ text, citations, supported: true })

async function draft(
  assessmentId: Types.ObjectId,
  sectionId: string,
  subsections: Sub[],
  templateVersion = VERSION,
) {
  return ReportSectionModel.create({
    assessment: assessmentId,
    sectionId,
    title: sectionId === '7' ? 'Construction' : 'Business Interruption',
    subsections,
    sources: {},
    questions: [],
    evidence: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v1',
      template_version: templateVersion,
      generated_at: new Date(),
    },
    createdBy: new Types.ObjectId(),
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
  })
}

// The template's headings for section 7, with the given statements under the narrative.
const section7 = (narrative: Sub['statements']): Sub[] => [
  { heading: 'Construction Narrative', kind: 'narrative', statements: narrative },
  { heading: 'Construction Table', kind: 'table', statements: [] },
  { heading: 'Compartmentalization and Fire Divisions', kind: 'narrative', statements: [] },
  { heading: 'Details on Combustible Construction', kind: 'narrative', statements: [] },
]

const checksOf = (run: { checks: { check: string }[] }, name: string) =>
  run.checks.filter((c) => c.check === name) as {
    sectionId: string | null
    check: string
    target: string
    result: string
    detail: string
  }[]

describe('findings need evidence (AC2)', () => {
  it('fails a statement with no citation and passes one that has a citation', async () => {
    const { assessment: a, session } = await assessment()
    const obs = await observation({ assessment: a._id, session: session._id })
    await draft(
      a._id,
      '7',
      section7([statement('Cited.', [`O:${obs._id}`]), statement('Nothing behind it.')]),
    )

    const run = await runEvaluation(REF, user)

    const findings = checksOf(run, 'finding-has-evidence')
    expect(findings.map((f) => [f.target, f.result])).toEqual([
      ['Construction Narrative #1', 'pass'],
      ['Construction Narrative #2', 'fail'],
    ])
    expect(findings[1].detail).toMatch(/no citation/i)
  })

  it('does not check table subsections, which are not drafted yet', async () => {
    const { assessment: a } = await assessment()
    const subs = section7([])
    subs[1].statements = [statement('A table row with no citation.')]
    await draft(a._id, '7', subs)
    expect(checksOf(await runEvaluation(REF, user), 'finding-has-evidence')).toEqual([])
  })
})

describe('citations must resolve (AC1)', () => {
  it('passes an observation of this assessment and fails deleted, foreign or unknown ones', async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    const good = await observation(ids)
    const gone = await observation(ids, { deleted: { at: new Date(), by: { id: 'x', name: 'X' } } })
    const other = await assessment('RPT-OTHER')
    const foreign = await observation({
      assessment: other.assessment._id,
      session: other.session._id,
    })
    const unknown = new Types.ObjectId()
    await draft(
      a._id,
      '7',
      section7([
        statement('a', [`O:${good._id}`]),
        statement('b', [`O:${gone._id}`]),
        statement('c', [`O:${foreign._id}`]),
        statement('d', [`O:${unknown}`]),
        statement('e', ['O:not-an-id']),
      ]),
    )

    const cites = checksOf(await runEvaluation(REF, user), 'citation-resolves')

    const byTarget = Object.fromEntries(cites.map((c) => [c.target, c]))
    expect(byTarget[`O:${good._id}`].result).toBe('pass')
    expect(byTarget[`O:${gone._id}`]).toMatchObject({ result: 'fail' })
    expect(byTarget[`O:${gone._id}`].detail).toMatch(/deleted/i)
    expect(byTarget[`O:${foreign._id}`].detail).toMatch(
      /another assessment|not an observation of this/i,
    )
    expect(byTarget[`O:${unknown}`].result).toBe('fail')
    expect(byTarget['O:not-an-id'].result).toBe('fail')
  })

  it('passes standard and past-report passages that exist, withdrawn ones included, and fails missing ones', async () => {
    const { assessment: a } = await assessment()
    lookup.mockImplementation((ids) =>
      json({
        results: ids.map((id) => ({
          id,
          exists: !id.includes('gone'),
          doc_id: 'doc1',
          status: id.startsWith('P:') ? 'withdrawn' : 'active',
          page_start: 3,
        })),
      }),
    )
    await draft(
      a._id,
      '7',
      section7([
        statement('a', ['C:doc1:4']),
        statement('b', ['P:doc1:9']),
        statement('c', ['C:gone:1']),
        statement('d', ['X:what']),
      ]),
    )

    const cites = checksOf(await runEvaluation(REF, user), 'citation-resolves')

    const byTarget = Object.fromEntries(cites.map((c) => [c.target, c]))
    expect(byTarget['C:doc1:4'].result).toBe('pass')
    expect(byTarget['P:doc1:9'].result).toBe('pass')
    expect(byTarget['P:doc1:9'].detail).toMatch(/withdrawn/i)
    expect(byTarget['C:gone:1']).toMatchObject({ result: 'fail' })
    expect(byTarget['C:gone:1'].detail).toMatch(/not found/i)
    expect(byTarget['X:what'].result).toBe('fail')
    // Only the passage ids go to rag-service; observation ids are checked in the database.
    expect(lookup.mock.calls[0][0].sort()).toEqual(['C:doc1:4', 'C:gone:1', 'P:doc1:9'])
  })

  it('marks passage checks unverified, not passed, when the lookup is down', async () => {
    const { assessment: a, session } = await assessment()
    const obs = await observation({ assessment: a._id, session: session._id })
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/sections') ? json(TEMPLATE) : json({ detail: 'down' }, 503),
    )
    await draft(a._id, '7', section7([statement('a', [`O:${obs._id}`, 'C:doc1:4'])]))

    const run = await runEvaluation(REF, user)

    const byTarget = Object.fromEntries(
      checksOf(run, 'citation-resolves').map((c) => [c.target, c]),
    )
    expect(byTarget['C:doc1:4'].result).toBe('unverified')
    expect(byTarget[`O:${obs._id}`].result).toBe('pass')
    expect(run.summary.status).toBe('incomplete')
    expect(run.summary.unverified).toBe(1)
  })
})

describe('the run is saved with its individual checks (AC5)', () => {
  it('keeps every check under the run id, with counts and the required metadata', async () => {
    const { assessment: a, session } = await assessment()
    const obs = await observation({ assessment: a._id, session: session._id })
    await draft(a._id, '7', section7([statement('ok', [`O:${obs._id}`]), statement('bare')]))

    const run = await runEvaluation(REF, user)

    const saved = await EvaluationRunModel.findById(run.id).lean()
    expect(saved?.reference).toBe(REF)
    expect(saved?.templateVersion).toBe(VERSION)
    expect(saved?.checks.length).toBe(run.checks.length)
    expect(saved?.summary).toMatchObject({ failed: 1, status: 'complete' })
    expect(saved?.metadata).toMatchObject({
      source_type: 'evaluation_run',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
    })
    expect(await EvaluationRunModel.countDocuments()).toBe(1)
  })
})

describe('required sections (AC3)', () => {
  it('names a section with no draft: fail for 7, only a warning for 12', async () => {
    await assessment()

    const run = await runEvaluation(REF, user)

    const required = checksOf(run, 'required-section')
    expect(required.map((c) => [c.sectionId, c.result])).toEqual([
      ['7', 'fail'],
      ['12', 'warn'],
    ])
    expect(required[0].detail).toMatch(/no draft/i)
  })

  it('passes a section that has a draft', async () => {
    const { assessment: a } = await assessment()
    await draft(a._id, '7', section7([]))
    const required = checksOf(await runEvaluation(REF, user), 'required-section')
    expect(required.map((c) => [c.sectionId, c.result])).toEqual([
      ['7', 'pass'],
      ['12', 'warn'],
    ])
  })
})

describe('heading structure (AC4)', () => {
  const headingChecks = async (subsections: Sub[], version = VERSION) => {
    const { assessment: a } = await assessment()
    await draft(a._id, '7', subsections, version)
    return checksOf(await runEvaluation(REF, user), 'heading-structure').filter(
      (c) => c.sectionId === '7',
    )
  }
  const without = (heading: string) => section7([]).filter((s) => s.heading !== heading)

  it('passes a draft whose headings match the template, ignoring case', async () => {
    const subs = section7([])
    subs[0].heading = 'construction narrative'
    expect(await headingChecks(subs)).toMatchObject([{ target: 'headings', result: 'pass' }])
  })

  it('fails a missing compulsory heading', async () => {
    const checks = await headingChecks(without('Compartmentalization and Fire Divisions'))
    expect(checks).toMatchObject([
      {
        target: 'Compartmentalization and Fire Divisions',
        result: 'fail',
        detail: 'Missing heading.',
      },
    ])
  })

  it('only warns about a missing optional or common heading', async () => {
    const checks = await headingChecks(
      without('Details on Combustible Construction').filter(
        (s) => s.heading !== 'Construction Table',
      ),
    )
    expect(checks.map((c) => [c.target, c.result])).toEqual([
      ['Construction Table', 'warn'],
      ['Details on Combustible Construction', 'warn'],
    ])
  })

  it('warns about a heading the template does not have', async () => {
    const checks = await headingChecks([
      ...section7([]),
      { heading: 'Roof Condition', kind: 'narrative', statements: [] },
    ])
    expect(checks).toMatchObject([{ target: 'Roof Condition', result: 'warn' }])
  })

  it('fails headings that are out of the template order', async () => {
    const [narrative, table, compartment, combustible] = section7([])
    const checks = await headingChecks([narrative, compartment, table, combustible])
    expect(checks).toMatchObject([{ target: 'order', result: 'fail' }])
  })

  it('warns when the draft was written with another template version', async () => {
    const checks = await headingChecks(section7([]), 'global-pre-v1.0')
    expect(checks).toMatchObject([{ target: 'template-version', result: 'warn' }])
    expect(checks[0].detail).toContain('global-pre-v1.0')
  })
})

describe('POST and GET /api/assessments/:reference/evaluation', () => {
  const person = (role: 'risk_engineer' | 'knowledge_admin', id = new Types.ObjectId()) => ({
    _id: id,
    staffId: `T-${id}`,
    name: role,
    email: `${id}@example.com`,
    role,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const assigned = signedInAs(app, person('risk_engineer', new Types.ObjectId(user.id)))
  const otherEngineer = signedInAs(app, person('risk_engineer'))
  const admin = signedInAs(app, person('knowledge_admin'))
  const url = `/api/assessments/${REF}/evaluation`

  it('runs the checks for the assigned engineer and saves the run (201)', async () => {
    const { assessment: a } = await assessment()
    await draft(a._id, '7', section7([statement('bare')]))
    const res = await assigned.post(url)
    expect(res.status).toBe(201)
    expect(res.body.reference).toBe(REF)
    expect(res.body.checks.some((c: { result: string }) => c.result === 'fail')).toBe(true)
    expect(await EvaluationRunModel.countDocuments()).toBe(1)
  })

  it('returns the latest run on GET, to anyone who can view assessments', async () => {
    const { assessment: a } = await assessment()
    await draft(a._id, '7', section7([]))
    await assigned.post(url)
    await draft(a._id, '7', section7([statement('newer, with no citation')]))
    const second = (await assigned.post(url)).body
    const res = await admin.get(url)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(second.id)
  })

  it('answers 404 when nothing has been run, or the assessment is unknown', async () => {
    await assessment()
    expect((await assigned.get(url)).status).toBe(404)
    expect((await assigned.post('/api/assessments/RPT-NOPE/evaluation')).status).toBe(404)
  })

  it('only lets the assigned engineer run it (403), not another engineer or the admin', async () => {
    await assessment()
    expect((await otherEngineer.post(url)).status).toBe(403)
    expect((await admin.post(url)).status).toBe(403)
    expect(await EvaluationRunModel.countDocuments()).toBe(0)
  })

  it('answers 503 when rag-service is down, and 401 without a session', async () => {
    await assessment()
    vi.stubGlobal('fetch', async () => json({ detail: 'down' }, 503))
    expect((await assigned.post(url)).status).toBe(503)
    const { default: request } = await import('supertest')
    expect((await request(app).get(url)).status).toBe(401)
  })
})
