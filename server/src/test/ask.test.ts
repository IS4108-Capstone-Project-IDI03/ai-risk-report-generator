import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { AssessmentQuestionModel } from '../models/assessment-question.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import type { UserRole } from '../models/user.model'
import { resetChatLimits } from '../services/chat-limits.service'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// Asking a question about an assessment (AS-01): who may ask, what S4 is told
// to search, and the answer streamed on, recorded and saved with its trace.
// S4 stands in as a stubbed fetch.

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
const colleague = person('Jide Okafor')
const asEngineer = signedInAs(app, engineer)
const asAdmin = signedInAs(app, admin)
const asColleague = signedInAs(app, colleague)

const REFERENCE = 'RPT-2026-0411'
const base = `/api/assessments/${REFERENCE}/ask`
const BAY_3 = new Types.ObjectId()

const USAGE = [
  {
    feature: 'ask',
    billed_service: 'anthropic',
    model: 'claude-opus-5-5',
    duration_ms: 900,
    input_tokens: 2000,
    output_tokens: 120,
    cache_read_tokens: null,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
  },
  {
    feature: 'retrieval',
    billed_service: 'cohere-embed',
    model: 'embed-v4.0',
    duration_ms: 100,
    input_tokens: 12,
    output_tokens: null,
    cache_read_tokens: null,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
  },
]
const STATEMENT = {
  text: 'The B1 sprinkler control valve was found shut.',
  citations: [{ ref: 'O:OBS', kind: 'observation', quote: null, verified: true }],
}
const TRACE = { story: 'AS-01', prompt_version: 'as01-v1', pipeline: ['retrieve'] }
const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`

// S4's stream for one answer: steps, a statement, then the result.
function answer(observationId: string, result: object = {}) {
  const statement = {
    ...STATEMENT,
    citations: [{ ...STATEMENT.citations[0], ref: `O:${observationId}` }],
  }
  return (
    event({ type: 'step', step: 'retrieve' }) +
    event({ type: 'step', step: 'generate', found: { observations: 1 } }) +
    event({
      type: 'statement',
      ...statement,
      sources: {
        [`O:${observationId}`]: { id: observationId, COPE_dimension: ['Protection'], note: 'x' },
      },
    }) +
    event({
      type: 'result',
      value: {
        statements: [statement],
        missing: [],
        sources: {
          [`O:${observationId}`]: { id: observationId, COPE_dimension: ['Protection'], note: 'x' },
          'C:fm:4': { text: 'Valves shall be supervised.', doc_id: 'fm', page_start: 4 },
        },
        confidence: 'high',
        declined: false,
        error: null,
        usage: USAGE,
        trace: TRACE,
        ...result,
      },
    })
  )
}

async function seedAssessment() {
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tilbury Distribution Centre',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const assessment = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    surveyType: 'First survey',
    engineer: engineer._id,
    locations: [{ _id: BAY_3, name: 'Bay 3', floor: 'Ground', key: 'bay 3|ground' }],
  })
  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  const observation = (cope: CopeDimension[] | null, note: string) =>
    ObservationModel.create({
      assessment: assessment._id,
      session: session._id,
      engineer: engineer.name,
      note,
      recordings: [],
      severity: 'high',
      location: BAY_3,
      metadata: {
        source_type: 'observation',
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: cope,
        effective_date: new Date(),
      },
    })
  const valve = await observation(['Protection'], 'B1 sprinkler control valve found shut.')
  const lights = await observation(null, 'Lobby lights flicker.')
  const gone = await observation(['Protection'], 'A deleted note.')
  await ObservationModel.updateOne(
    { _id: gone._id },
    { deleted: { at: new Date(), by: { id: 'x', name: 'x' } } },
  )
  return { assessment, valve, lights }
}

// A finished knowledge document.
const knowledge = (
  title: string,
  sourceType: 'fm_standard' | 'nfpa_standard' | 'marsh_report',
  over: { jurisdiction?: string; facilityType?: string; withdrawn?: boolean } = {},
) =>
  KnowledgeDocumentModel.create({
    title,
    issuingBody: sourceType === 'marsh_report' ? 'Marsh' : 'FM Global',
    standardNumber: sourceType === 'marsh_report' ? undefined : title.split(' ').pop(),
    edition: sourceType === 'marsh_report' ? undefined : '2026',
    fileName: `${title}.pdf`,
    file: { key: `k/${title}.pdf`, contentType: 'application/pdf', size: 1, sha256: title },
    status: 'complete',
    unconfirmed: [],
    metadata: {
      source_type: sourceType,
      jurisdiction: over.jurisdiction ?? 'all',
      facility_type: over.facilityType ?? 'all',
      effective_date: new Date('2026-01-01'),
    },
    withdrawn: over.withdrawn
      ? { at: new Date(), by: { id: 'admin', name: 'Sana Patel' } }
      : undefined,
  })

const checklist = (assessment: Types.ObjectId, standards: { id: string; title: string }[]) =>
  ChecklistModel.create({
    assessment,
    facilityType: 'Warehouse',
    jurisdiction: 'SG',
    standards,
    provenance: {
      provider: 'anthropic',
      effort: 'medium',
      prompt_version: 'cp30',
      checklist_version: '1',
      template_version: '1',
      generated_at: new Date(),
    },
    createdBy: engineer._id,
    metadata: {
      source_type: 'checklist',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })

// The events a streamed response holds.
const eventsOf = (text: string) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)))

beforeEach(() => resetChatLimits())
afterEach(() => vi.unstubAllGlobals())

describe('who may ask (AC7)', () => {
  it('needs a session, the reports:ask permission and an assessment the user can open', async () => {
    await seedAssessment()
    expect((await request(app).get(base)).status).toBe(401)
    expect((await request(app).post(base).send({ question: 'Valve?' })).status).toBe(401)
    // A role outside the matrix has no permissions.
    const nobody = signedInAsRole(app, 'reviewer' as UserRole)
    expect((await nobody.post(base).send({ question: 'Valve?' })).status).toBe(403)
    // A risk engineer the assessment is not assigned to cannot open it.
    expect((await asColleague.get(base)).status).toBe(403)
    expect((await asColleague.post(base).send({ question: 'Valve?' })).status).toBe(403)
    expect(await AssessmentQuestionModel.countDocuments()).toBe(0)
  })

  it('refuses an empty question before anything is saved or asked', async () => {
    await seedAssessment()
    const sent = vi.fn()
    vi.stubGlobal('fetch', sent)
    const res = await asEngineer.post(base).send({ question: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.fields.question).toBe('Type a question to ask.')
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('asking (AC2, AC3, AC6)', () => {
  it('limits the search to the observations, the selected standards and matching past reports', async () => {
    const { assessment, valve, lights } = await seedAssessment()
    const kept = await knowledge('FM Global 2-81', 'fm_standard')
    const withdrawn = await knowledge('FM Global 3-26', 'fm_standard', { withdrawn: true })
    await knowledge('FM Global 8-9', 'fm_standard')
    const report = await knowledge('Jurong warehouse survey', 'marsh_report', {
      jurisdiction: 'SG',
      facilityType: 'Warehouse',
    })
    await knowledge('Mall survey', 'marsh_report', { jurisdiction: 'SG', facilityType: 'Mall' })
    await checklist(assessment._id, [
      { id: String(kept._id), title: 'FM Global 2-81' },
      { id: String(withdrawn._id), title: 'FM Global 3-26' },
    ])
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      sent(url, JSON.parse(String(init!.body)))
      return new Response(answer(String(valve._id)), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })

    const res = await asEngineer.post(base).send({ question: 'Was the valve shut?' })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    const [url, body] = sent.mock.calls[0]
    expect(url).toMatch(/\/assessments\/ask$/)
    expect(body.question).toBe('Was the valve shut?')
    expect(body.assessment).toEqual({
      reference: REFERENCE,
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
    })
    // Every observation not deleted, uncategorised ones included.
    type Sent = { id: string; COPE_dimension: string[] | null; location: string }
    const byId = new Map<string, Sent>(body.observations.map((o: Sent) => [o.id, o]))
    expect([...byId.keys()].sort()).toEqual([String(valve._id), String(lights._id)].sort())
    expect(byId.get(String(lights._id))!.COPE_dimension).toBeNull()
    expect(byId.get(String(valve._id))!.location).toBe('Bay 3, Ground')
    // The checklist's standards, without the one withdrawn since (AC3).
    expect(body.standard_ids).toEqual([String(kept._id)])
    expect(body.documents).toEqual([
      { id: String(kept._id), name: 'FM Global 2-81 (2026)' },
      { id: String(report._id), name: 'Jurong warehouse survey' },
    ])
    expect(body.privacy).toEqual({ enabled: false, known_entities: [] })

    // The browser gets the steps, the statement and the saved answer, never the usage or trace.
    const events = eventsOf(res.text)
    expect(events.map((e) => e.type)).toEqual(['question', 'step', 'step', 'statement', 'result'])
    expect(res.text).not.toContain('usage')
    expect(res.text).not.toContain('as01-v1')
    // A statement brings its sources, so its citation opens before the answer ends (AC2).
    expect(events[3].observations.map((o: { id: string }) => o.id)).toEqual([String(valve._id)])
    const { answer: shown } = events[4]
    expect(shown.status).toBe('complete')
    expect(shown.confidence).toBe('high')
    expect(shown.statements[0].text).toBe(STATEMENT.text)
    expect(shown.observations[0].id).toBe(String(valve._id))
    expect(shown.passages[0]).toMatchObject({ id: 'C:fm:4', kind: 'standard', pageStart: 4 })

    // Saved with its trace (AC6), and its paid calls recorded for the report.
    const [saved] = await AssessmentQuestionModel.find().lean()
    expect(saved.status).toBe('complete')
    expect(saved.trace).toEqual(TRACE)
    expect(saved.metadata.source_type).toBe('assessment_question')
    const calls = await AiCallModel.find().sort({ feature: 1 }).lean()
    expect(calls.map((c) => [c.feature, c.reportId])).toEqual([
      ['ask', REFERENCE],
      ['retrieval', REFERENCE],
    ])
  })

  it('searches every standard that applies to the site before any checklist', async () => {
    const { valve } = await seedAssessment()
    const applies = await knowledge('FM Global 2-81', 'fm_standard')
    await knowledge('NFPA 13', 'nfpa_standard', { jurisdiction: 'US' })
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent(JSON.parse(String(init!.body)))
      return new Response(answer(String(valve._id)))
    })
    await asEngineer.post(base).send({ question: 'Valve?' })
    expect(sent.mock.calls[0][0].standard_ids).toEqual([String(applies._id)])
  })

  it("keeps a quote from a picture's AI description marked as described (KB-02)", async () => {
    const { valve } = await seedAssessment()
    const figure = {
      text: 'The valve is chained.',
      citations: [
        {
          ref: 'C:fm:4',
          kind: 'standard',
          quote: 'A valve with a chain',
          verified: false,
          described: true,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      async () => new Response(answer(String(valve._id), { statements: [figure] })),
    )
    await asEngineer.post(base).send({ question: 'Is the valve chained?' })

    const res = await asEngineer.get(base)
    expect(res.body.questions[0].statements[0].citations).toEqual([
      {
        ref: 'C:fm:4',
        kind: 'standard',
        quote: 'A valve with a chain',
        verified: false,
        described: true,
      },
    ])
  })

  it("lets a knowledge admin ask, and lists only the asker's own questions", async () => {
    const { valve } = await seedAssessment()
    vi.stubGlobal('fetch', async () => new Response(answer(String(valve._id))))
    await asEngineer.post(base).send({ question: 'Was the valve shut?' })
    expect((await asAdmin.post(base).send({ question: 'Admin question' })).status).toBe(200)

    const res = await asEngineer.get(base)
    expect(res.status).toBe(200)
    expect(res.body.questions.map((q: { question: string }) => q.question)).toEqual([
      'Was the valve shut?',
    ])
    expect(res.body.scope).toMatchObject({
      observations: 2,
      jurisdiction: 'SG',
      facilityType: 'Warehouse',
      standardsFrom: 'applicable',
    })
  })
})

describe('failures (AC8)', () => {
  it('states the cause and time when the answer service cannot be reached', async () => {
    await seedAssessment()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const res = await asEngineer.post(base).send({ question: 'Was the valve shut?' })
    const result = eventsOf(res.text).at(-1)
    expect(result.type).toBe('result')
    expect(result.answer.status).toBe('failed')
    expect(result.answer.error).toMatchObject({ cause: 'the answer service could not be reached' })
    expect(Date.parse(result.answer.error.at)).not.toBeNaN()
    const [saved] = await AssessmentQuestionModel.find().lean()
    expect(saved.status).toBe('failed')
  })

  it('keeps what was answered when the model stops part-way', async () => {
    const { valve } = await seedAssessment()
    const at = '2026-11-09T06:02:00.000Z'
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          answer(String(valve._id), {
            confidence: 'high',
            error: { step: 'generate', cause: 'the model provider did not respond', at },
          }),
        ),
    )
    const res = await asEngineer.post(base).send({ question: 'Was the valve shut?' })
    const { answer: shown } = eventsOf(res.text).at(-1)
    expect(shown.status).toBe('stopped')
    expect(shown.statements).toHaveLength(1)
    expect(shown.error).toEqual({
      step: 'generate',
      cause: 'the model provider did not respond',
      at,
    })
  })

  it('refuses over the question limits with the cause and the next step', async () => {
    await seedAssessment()
    vi.stubGlobal('fetch', async () => new Response(event({ type: 'result', value: {} })))
    for (let n = 0; n < 10; n++) await asEngineer.post(base).send({ question: `Q${n}` })
    const res = await asEngineer.post(base).send({ question: 'One more' })
    expect(res.status).toBe(429)
    expect(res.body).toMatchObject({
      cause: 'more than 10 questions were asked in a minute',
      next: 'Ask again in a minute.',
    })
  })
})

// AS-02: a question about a passage selected in the draft. Section 9 is
// drafted with three findings: the first cites the valve and a standard, the
// second the valve, and the third, rejected, nothing.
const MARKER = '￼'
async function draftedNine() {
  const seeded = await seedAssessment()
  const { assessment, valve } = seeded
  const standard = await knowledge('FM Global 2-81', 'fm_standard')
  const valveRef = `O:${valve._id}`
  const standardRef = `C:${standard._id}:4`
  const draft = await ReportSectionModel.create({
    assessment: assessment._id,
    sectionId: '9',
    title: 'Fire Protection',
    subsections: [
      {
        heading: 'Sprinkler Protection',
        kind: 'narrative',
        statements: [
          {
            text: 'The B1 control valve was shut.',
            citations: [valveRef, standardRef],
            supported: true,
          },
          { text: 'No tamper switch was fitted.', citations: [valveRef], supported: true },
          { text: 'Sprinklers are generally reliable.', citations: [], supported: false },
        ],
      },
    ],
    sources: {
      [standardRef]: {
        text: 'Sprinkler control valves shall be supervised in the open position.',
        doc_id: String(standard._id),
        headings: ['Valves'],
        page_start: 4,
        page_end: 4,
      },
    },
    questions: [],
    evidence: [
      {
        id: String(valve._id),
        COPE_dimension: ['Protection'],
        note: 'B1 sprinkler control valve found shut.',
        transcripts: [],
        severity: 'high',
        location: 'Bay 3, Ground',
        standard: null,
      },
      // An observation deleted since drafting, cited by no finding.
      {
        id: 'gone',
        COPE_dimension: ['Protection'],
        note: 'Pump room door wedged open.',
        transcripts: [],
        severity: 'moderate',
        location: null,
        standard: null,
      },
    ],
    guardrail: { passed: false, unsupported_count: 1 },
    provenance: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'high',
      prompt_version: 'gn01-v2.4',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: new Date(),
    },
    createdBy: engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Protection',
      effective_date: new Date(),
    },
  })
  await ReviewAuditModel.create({
    assessment: assessment._id,
    sectionId: '9',
    draft: draft._id,
    finding: '0.2',
    sequence: 0,
    action: 'reject',
    by: { id: String(engineer._id), name: engineer.name },
    at: new Date(),
    metadata: {
      source_type: 'review_decision',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Protection',
      effective_date: new Date(),
    },
  })
  return { ...seeded, standard, draft, valveRef, standardRef }
}

// The first finding's words and its two citation markers, as the document
// editor's text holds them, then the second finding.
const SECTION_TEXT = `The B1 control valve was shut.${MARKER}${MARKER}\nNo tamper switch was fitted.${MARKER}`
const ON_VALVE = {
  sectionId: '9',
  start: 4,
  end: 32,
  exact: `B1 control valve was shut.${MARKER}${MARKER}`,
  prefix: 'The ',
  suffix: '\nNo tamper switch was fitted.' + MARKER,
}
// What the report holds, to show asking changed none of it (AC5).
async function reportNow() {
  const strip = (docs: object[]) => JSON.stringify(docs)
  return {
    sections: strip(await ReportSectionModel.find().lean()),
    versions: strip(await ReportSectionVersionModel.find().lean()),
    reviews: strip(await ReviewAuditModel.find().lean()),
    threads: await ReportCommentThreadModel.countDocuments(),
  }
}

describe('asking about a selected passage (AS-02)', () => {
  it('sends the section, the passage, its citations and the findings, and saves its anchor', async () => {
    const { valve, standard, valveRef, standardRef } = await draftedNine()
    expect(SECTION_TEXT.slice(ON_VALVE.start, ON_VALVE.end)).toBe(ON_VALVE.exact)
    const before = await reportNow()
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent(JSON.parse(String(init!.body)))
      return new Response(answer(String(valve._id)))
    })

    const res = await asEngineer.post(base).send({
      question: 'Where does this come from?',
      passage: {
        anchor: ON_VALVE,
        // A citation the draft does not hold is not sent as one.
        citations: [valveRef, standardRef, 'C:made-up:1'],
        findings: ['0.0', '7.7'],
      },
    })

    expect(res.status).toBe(200)
    const body = sent.mock.calls[0][0]
    expect(body.passage).toEqual({
      section_id: '9',
      section_title: '9. Fire Protection',
      // The words as selected, the citation markers left out.
      text: 'B1 control valve was shut.',
      citations: [valveRef, standardRef],
      sources: [
        {
          id: `${standard._id}:4`,
          kind: 'standard',
          text: 'Sprinkler control valves shall be supervised in the open position.',
          metadata: {
            doc_id: String(standard._id),
            headings: ['Valves'],
            page_start: 4,
            page_end: 4,
          },
        },
      ],
      // The section's findings still in the draft, the one the passage is in marked.
      findings: [
        {
          text: 'The B1 control valve was shut.',
          state: 'pending',
          citations: [valveRef, standardRef],
          in_passage: true,
        },
        {
          text: 'No tamper switch was fitted.',
          state: 'pending',
          citations: [valveRef],
          in_passage: false,
        },
      ],
    })
    // The cited standard's name reaches the prompt, as a selected one's does.
    expect(body.documents).toContainEqual({
      id: String(standard._id),
      name: 'FM Global 2-81 (2026)',
    })

    // Saved with the passage's anchor in RV-03's format (AC3), shown with the answer.
    const passage = {
      anchor: ON_VALVE,
      label: '9. Fire Protection',
      citations: [valveRef, standardRef],
      findings: ['0.0'],
    }
    const [saved] = await AssessmentQuestionModel.find().lean()
    expect(saved.passage).toMatchObject(passage)
    expect(eventsOf(res.text).at(-1).answer.passage).toEqual(passage)
    const listed = await asEngineer.get(base)
    expect(listed.body.questions[0].passage).toEqual(passage)

    // Asking changed nothing in the report: no text, version or review state (AC5).
    expect(await reportNow()).toEqual(before)
  })

  it('sends a cited observation deleted since, as the draft was given it', async () => {
    await draftedNine()
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent(JSON.parse(String(init!.body)))
      return new Response(event({ type: 'result', value: {} }))
    })
    await asEngineer.post(base).send({
      question: 'Why?',
      passage: {
        anchor: { ...ON_VALVE, start: 0, end: 4, exact: 'The ', prefix: '', suffix: 'B1' },
        citations: ['O:gone'],
        findings: [],
      },
    })
    const body = sent.mock.calls[0][0]
    expect(body.passage.citations).toEqual(['O:gone'])
    expect(body.observations).toContainEqual(
      expect.objectContaining({ id: 'gone', note: 'Pump room door wedged open.' }),
    )
  })

  it('passes on a line naming where the sources disagree, and saves it', async () => {
    const { valve, valveRef } = await draftedNine()
    const differs = {
      text: 'the observation records the valve shut, while the standard requires it open.',
      citations: [
        { ref: `O:${valve._id}`, kind: 'observation', quote: null, verified: true },
        {
          ref: 'C:fm:4',
          kind: 'standard',
          quote: 'supervised in the open position',
          verified: true,
        },
      ],
      differs: true,
    }
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          event({ type: 'statement', ...differs, sources: {} }) +
            event({
              type: 'result',
              value: { statements: [differs], missing: [], sources: {}, confidence: 'medium' },
            }),
        ),
    )
    const res = await asEngineer.post(base).send({
      question: 'Do the sources agree?',
      passage: { anchor: ON_VALVE, citations: [valveRef], findings: ['0.0'] },
    })
    const events = eventsOf(res.text)
    expect(events.find((e) => e.type === 'statement').differs).toBe(true)
    expect(events.at(-1).answer.statements[0].differs).toBe(true)
    const [saved] = await AssessmentQuestionModel.find().lean()
    expect(saved.statements[0].differs).toBe(true)
  })

  it('refuses a passage with no words, one too long, or one whose quote does not match', async () => {
    await draftedNine()
    const sent = vi.fn()
    vi.stubGlobal('fetch', sent)
    const ask = (anchor: object) =>
      asEngineer.post(base).send({ question: 'Why?', passage: { anchor } })

    const markers = await ask({ ...ON_VALVE, start: 30, end: 32, exact: MARKER + MARKER })
    expect(markers.status).toBe(400)
    expect(markers.body.fields['passage.anchor.exact']).toBe(
      'Select some of the text to ask about.',
    )
    const long = 'x'.repeat(4001)
    const tooLong = await ask({ ...ON_VALVE, start: 0, end: 4001, exact: long })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.fields['passage.anchor.exact']).toBe(
      'Select up to 4,000 characters to ask about.',
    )
    expect((await ask({ ...ON_VALVE, end: 99 })).status).toBe(400)
    expect(sent).not.toHaveBeenCalled()
    expect(await AssessmentQuestionModel.countDocuments()).toBe(0)
  })
})
