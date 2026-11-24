import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantConversationModel } from '../models/assistant-conversation.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import type { UserRole } from '../models/user.model'
import { resetChatLimits } from '../services/chat-limits.service'
import { blockerInputs, detailedBlockers } from '../services/export.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// Writing guidance for a section (AS-08), asked from the Ask tab's two
// buttons. "What should this section cover?" goes to S4 with the section, to be
// answered from its template definition and the selected standards (AC1).
// "What is missing from this section?" is listed by the gateway with no AI
// call: the export check's own blockers first (AC3), then the parts with no
// text, the tables reading "Not entered", the COPE categories with no
// observation and the observations the draft leaves out, each a fact (AC4)
// with a link (AC2). Neither changes the report (AC5). S4 is a stubbed fetch.

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
const engineer = person('Alex Rowe')
const admin = person('Sana Patel', 'knowledge_admin')
const asEngineer = signedInAs(app, engineer)
const asAdmin = signedInAs(app, admin)

const REFERENCE = 'RPT-2026-0707'
const base = `/api/assessments/${REFERENCE}/ask`
const PUMP_ROOM = new Types.ObjectId()

// Sections 7 and 9 as S4's GET /sections lists them, with their parts (AS-08).
const TEMPLATE = [
  {
    id: '7',
    title: 'Construction',
    cope_dimensions: ['Construction'],
    min_observations: 1,
    subsections: [
      { heading: 'Construction Narrative', kind: 'narrative' },
      { heading: 'Construction Table', kind: 'table' },
      { heading: 'Compartmentalization and Fire Divisions', kind: 'narrative' },
    ],
  },
  {
    id: '9',
    title: 'Fire Protection',
    cope_dimensions: ['Protection'],
    min_observations: 1,
    subsections: [
      { heading: 'Automatic Sprinkler Protection', kind: 'table' },
      { heading: 'Water Supply Details', kind: 'narrative' },
    ],
  },
]

const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`
const json = (body: object) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

// S4's stream for "What should 9. Fire Protection cover?": a statement citing
// the template's Water Supply Details part.
const PART = {
  text: 'Water Supply Details: a part written as text.',
  section_id: '9',
  section_title: '9. Fire Protection',
  subsection: 1,
  heading: 'Water Supply Details',
  kind: 'narrative',
  fields: [],
}
const COVERS = {
  text: 'Water Supply Details is a part written as text.',
  citations: [{ ref: 'T:9.1', kind: 'template', quote: null, verified: true, described: false }],
}
function covered() {
  const sources = { 'T:9.1': PART }
  return (
    event({ type: 'step', step: 'retrieve' }) +
    event({ type: 'statement', ...COVERS, sources }) +
    event({
      type: 'result',
      value: {
        statements: [COVERS],
        missing: [],
        sources,
        confidence: 'high',
        error: null,
        usage: [],
        trace: {
          story: 'AS-08',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          prompt_version: 'as08-v1',
          guide: { kind: 'cover', section_id: '9', template_parts: 3, template_parts_cited: 1 },
        },
      },
    })
  )
}

// Every call to S4: its path and body (GET /sections has none).
let calls: { path: string; body: Record<string, unknown> | null }[] = []

function stubS4() {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (path === '/sections') return json({ sections: TEMPLATE })
    if (path === '/assessments/ask') return new Response(covered())
    return json({})
  })
}

type Statement = IReportSection['subsections'][number]['statements'][number]

// Section 7 drafted with two findings, one unsupported, and nothing written
// under its third part. Drafted with no evidence, so the observation saved
// since makes it out of date.
async function draftSeven(assessment: Types.ObjectId) {
  const statements: Statement[] = [
    { text: 'The roof is steel deck.', citations: [], supported: true },
    { text: 'The walls are fire-rated.', citations: [], supported: false },
  ]
  return ReportSectionModel.create({
    assessment,
    sectionId: '7',
    title: 'Construction',
    subsections: [
      { heading: 'Construction Narrative', kind: 'narrative', statements },
      { heading: 'Construction Table', kind: 'table', statements: [] },
      { heading: 'Compartmentalization and Fire Divisions', kind: 'narrative', statements: [] },
    ],
    sources: {},
    evidence: [],
    questions: [],
    guardrail: { passed: false, unsupported_count: 1 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.3',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: new Date(),
    },
    createdBy: engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
  })
}

async function observation(
  assessment: Types.ObjectId,
  session: Types.ObjectId,
  categories: CopeDimension[],
  severity: string | null,
) {
  return ObservationModel.create({
    assessment,
    session,
    engineer: engineer.name,
    note: 'Steel deck roof over the warehouse.',
    recordings: [],
    ...(severity && { severity }),
    location: PUMP_ROOM,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: categories,
      effective_date: new Date(),
    },
  })
}

// The assessment, Section 7 drafted, one usable Construction observation and
// one tagged Construction still to check (no severity). Nothing is tagged Protection.
async function seed() {
  const site = await SiteModel.create({
    code: 'SITE-0707',
    name: 'Tuas Cold Store',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const assessment = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    surveyType: 'First survey',
    engineer: engineer._id,
    locations: [
      { _id: PUMP_ROOM, name: 'Pump room', floor: 'Basement 1', key: 'pump room|basement 1' },
    ],
  })
  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  await draftSeven(assessment._id)
  await observation(assessment._id, session._id, ['Construction'], 'high')
  const toCheck = await observation(assessment._id, session._id, ['Construction'], null)
  return { assessment, toCheck }
}

const eventsOf = (text: string) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)))

async function guide(
  as: typeof asEngineer,
  kind: 'cover' | 'missing',
  sectionId: string,
  conversation?: string,
) {
  const res = await as
    .post(base)
    .send({ guide: { kind, sectionId }, ...(conversation && { conversation }) })
  expect(res.status).toBe(200)
  return eventsOf(res.text)
}

// What the report holds, to show guidance changes none of it (AC5).
async function reportNow() {
  const all = (docs: object[]) => JSON.stringify(docs)
  return {
    sections: all(await ReportSectionModel.find().lean()),
    versions: all(await ReportSectionVersionModel.find().lean()),
    reviews: all(await ReviewAuditModel.find().lean()),
    threads: await ReportCommentThreadModel.countDocuments(),
    assessment: all(await AssessmentModel.find().lean()),
  }
}

type Gap = { kind: string; fact: string; blocksExport: boolean; link: Record<string, unknown> }

beforeEach(() => {
  resetChatLimits()
  stubS4()
})
afterEach(() => vi.unstubAllGlobals())

describe('What is missing from this section? (AC2)', () => {
  it('lists the gaps as facts, each with a link, with no AI call', async () => {
    const { toCheck } = await seed()
    const [question, result] = await guide(asEngineer, 'missing', '7')
    expect(question).toMatchObject({
      type: 'question',
      question: 'What is missing from 7. Construction?',
    })
    expect(result.type).toBe('result')
    const answer = result.answer
    expect(answer).toMatchObject({
      question: 'What is missing from 7. Construction?',
      guidance: { kind: 'missing', sectionId: '7', label: '7. Construction' },
      status: 'complete',
      statements: [],
      confidence: null,
    })
    expect(answer.gaps).toEqual([
      {
        kind: 'pending_findings',
        fact: 'Section 7 has 2 findings waiting for a decision.',
        blocksExport: true,
        link: { to: 'section', sectionId: '7', finding: '0.0' },
      },
      {
        kind: 'unsupported_findings',
        fact: 'Section 7 has 1 finding unsupported by evidence.',
        blocksExport: true,
        link: { to: 'section', sectionId: '7', finding: '0.1' },
      },
      {
        kind: 'out_of_date',
        fact: "Section 7's draft is out of date: its evidence changed since it was drafted.",
        blocksExport: true,
        link: { to: 'section', sectionId: '7' },
      },
      {
        kind: 'no_text',
        fact: 'Section 7 has no text under Compartmentalization and Fire Divisions.',
        blocksExport: false,
        link: { to: 'section', sectionId: '7', subsection: 2 },
      },
      {
        kind: 'table',
        fact: "Section 7's Construction Table reads Not entered.",
        blocksExport: false,
        link: { to: 'section', sectionId: '7', subsection: 1 },
      },
      {
        kind: 'observation',
        fact: "The observation at Pump room, Basement 1 is tagged Construction but is still to check, so Section 7's draft leaves it out.",
        blocksExport: false,
        link: { to: 'observation', observationId: String(toCheck._id) },
      },
    ])
    // Listed by the gateway: S4 was only read for the template's sections.
    expect(calls.map((c) => c.path).filter((p) => p !== '/sections')).toEqual([])
  })

  it('names a COPE category with no observation, linking to the Observations tab', async () => {
    await seed()
    const [, result] = await guide(asEngineer, 'missing', '9')
    const gaps: Gap[] = result.answer.gaps
    expect(gaps).toEqual([
      {
        kind: 'not_written',
        fact: 'Section 9 is not written yet.',
        blocksExport: true,
        link: { to: 'section', sectionId: '9' },
      },
      {
        kind: 'table',
        fact: "Section 9's Automatic Sprinkler Protection table reads Not entered.",
        blocksExport: false,
        link: { to: 'section', sectionId: '9', subsection: 0 },
      },
      {
        kind: 'category',
        fact: 'Section 9 has no observation tagged Protection.',
        blocksExport: false,
        link: { to: 'observation', observationId: null },
      },
    ])
  })

  it('answers for Sections 2 and 3 from the export check alone', async () => {
    await seed()
    const [, two] = await guide(asEngineer, 'missing', '2')
    expect(two.answer.guidance.label).toBe('2. Executive Summary')
    expect(two.answer.gaps).toEqual([
      {
        kind: 'not_drafted',
        fact: 'Section 2 is not drafted yet.',
        blocksExport: true,
        link: { to: 'section', sectionId: '2' },
      },
    ])
    const [, three] = await guide(asEngineer, 'missing', '3')
    expect(three.answer.gaps.map((g: Gap) => g.fact)).toEqual([
      'Section 3 has no accepted Opportunity for Improvement yet.',
    ])
  })

  it('is kept in the conversation, with a trace and no provider or model', async () => {
    await seed()
    const [first] = await guide(asEngineer, 'missing', '7')
    await guide(asEngineer, 'missing', '9', first.conversation.id)
    const [conversation] = await AssistantConversationModel.find().lean()
    expect(conversation.title).toBe('What is missing from 7. Construction?')
    expect(conversation.turns).toHaveLength(2)
    const [turn] = conversation.turns
    expect(turn.guidance).toEqual({ kind: 'missing', sectionId: '7', label: '7. Construction' })
    expect(turn.gaps).toHaveLength(6)
    expect(turn).toMatchObject({ provider: null, model: null, promptVersion: null })
    expect(turn.trace).toMatchObject({
      story: 'AS-08',
      guide: 'missing',
      pipeline: ['check'],
      section_id: '7',
      gaps: 6,
      blocking: 3,
    })
    // Read back as the tab shows it.
    const listed = await asEngineer.get(base)
    expect(listed.body.questions[0].gaps).toHaveLength(6)
    expect(listed.body.questions[1].guidance.sectionId).toBe('9')
  })
})

describe('gaps that block the export are the export check’s own (AC3)', () => {
  it('lists exactly what the Export tab lists for the section, in its order', async () => {
    await seed()
    const [, result] = await guide(asEngineer, 'missing', '7')
    const blocking = (result.answer.gaps as Gap[]).filter((g) => g.blocksExport)
    const check = await asEngineer.get(`/api/assessments/${REFERENCE}/export`)
    expect(check.status).toBe(200)
    const exported = check.body.blockers.filter((b: { sectionId: string }) => b.sectionId === '7')
    expect(blocking).toHaveLength(exported.length)
    const detailed = detailedBlockers(await blockerInputs(REFERENCE)).filter(
      (b) => b.sectionId === '7',
    )
    expect(detailed.map((b) => b.reason)).toEqual(exported.map((b: { reason: string }) => b.reason))
    expect(blocking.map((g) => g.fact)).toEqual(detailed.map((b) => b.fact))
  })
})

describe('gaps are stated as facts, never as advice (AC4)', () => {
  it('gives no next step and tells no one what to do', async () => {
    await seed()
    const facts: string[] = []
    for (const id of ['2', '3', '7', '9']) {
      const [, result] = await guide(asEngineer, 'missing', id)
      facts.push(...(result.answer.gaps as Gap[]).map((g) => g.fact))
    }
    expect(facts.length).toBeGreaterThan(8)
    for (const fact of facts) {
      expect(fact).toMatch(/^(Section \d+|The observation|An observation|\d+ more)/)
      expect(fact).not.toMatch(
        /\b(should|must|need to|please|draft it|enter|review the|give it|try|consider)\b/i,
      )
      expect(fact).not.toMatch(/\b(you|your|I|we)\b/)
    }
  })
})

describe('What should this section cover? (AC1)', () => {
  it('asks S4 with the section, the selected standards and no observations', async () => {
    await seed()
    const events = await guide(asEngineer, 'cover', '9')
    expect(events[0]).toMatchObject({
      type: 'question',
      question: 'What should 9. Fire Protection cover?',
    })
    const sent = calls.find((c) => c.path === '/assessments/ask')!.body!
    expect(sent).toMatchObject({
      question: 'What should 9. Fire Protection cover?',
      observations: [],
      standard_ids: [],
      documents: [],
      guide: { kind: 'cover', section_id: '9', section_title: '9. Fire Protection' },
    })
    expect(sent).not.toHaveProperty('passage')
    expect(sent).not.toHaveProperty('propose')

    // A statement's template citation comes with the part it cites.
    const statement = events.find((e) => e.type === 'statement')
    expect(statement.template).toEqual([
      {
        id: 'T:9.1',
        sectionId: '9',
        label: '9. Fire Protection',
        subsection: 1,
        heading: 'Water Supply Details',
        kind: 'narrative',
        fields: [],
        text: 'Water Supply Details: a part written as text.',
      },
    ])
    expect(statement.passages).toEqual([])
    const { answer } = events.at(-1)
    expect(answer.guidance).toEqual({ kind: 'cover', sectionId: '9', label: '9. Fire Protection' })
    expect(answer.statements[0].citations[0]).toMatchObject({ ref: 'T:9.1', kind: 'template' })
    expect(answer.template).toHaveLength(1)
    expect(answer.passages).toEqual([])
    expect(answer.gaps).toEqual([])

    const [conversation] = await AssistantConversationModel.find().lean()
    const [turn] = conversation.turns
    expect(turn.guidance).toEqual({ kind: 'cover', sectionId: '9', label: '9. Fire Protection' })
    expect(turn.promptVersion).toBe('as08-v1')
    expect(turn.statements[0].citations[0].kind).toBe('template')
  })

  it('refuses a part the template does not define', async () => {
    await seed()
    // Section 12 is not in this template; Section 2 is never asked what it covers.
    const twelve = await asEngineer.post(base).send({ guide: { kind: 'cover', sectionId: '12' } })
    expect(twelve.status).toBe(404)
    const two = await asEngineer.post(base).send({ guide: { kind: 'cover', sectionId: '2' } })
    expect(two.status).toBe(400)
    expect(two.body.fields['guide.sectionId']).toBe(
      'Open one of Sections 4 to 12 to ask what it should cover.',
    )
    const one = await asEngineer.post(base).send({ guide: { kind: 'missing', sectionId: '1' } })
    expect(one.status).toBe(400)
    expect(await AssistantConversationModel.countDocuments()).toBe(0)
  })
})

describe('who may ask, and when', () => {
  it('lets a knowledge admin ask, as for any question', async () => {
    await seed()
    const [, result] = await guide(asAdmin, 'missing', '7')
    expect(result.answer.gaps.length).toBeGreaterThan(0)
  })

  it('asks for guidance on its own, never with a passage or a request for text', async () => {
    await seed()
    const res = await asEngineer.post(base).send({
      guide: { kind: 'missing', sectionId: '7' },
      propose: { kind: 'draft', sectionId: '7' },
    })
    expect(res.status).toBe(400)
  })

  it('is refused on an archived assessment (409)', async () => {
    const { assessment } = await seed()
    await AssessmentModel.updateOne({ _id: assessment._id }, { archivedAt: new Date() })
    const res = await asEngineer.post(base).send({ guide: { kind: 'missing', sectionId: '7' } })
    expect(res.status).toBe(409)
    expect(res.body.cause).toBe('the assessment is archived, so its conversations are read only')
  })
})

describe('guidance never changes the report (AC5)', () => {
  it('leaves sections, versions, the review log, threads and the assessment as they were', async () => {
    await seed()
    const before = await reportNow()
    await guide(asEngineer, 'missing', '7')
    await guide(asEngineer, 'cover', '9')
    expect(await reportNow()).toEqual(before)
  })
})
