import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantConversationModel } from '../models/assistant-conversation.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import {
  ReportSectionVersionModel,
  type DocumentInline,
  type SectionDocument,
} from '../models/report-section-version.model'
import { ReportTextProposalModel } from '../models/report-text-proposal.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel, type UserRole } from '../models/user.model'
import { resetChatLimits } from '../services/chat-limits.service'
import { exportBlockers } from '../services/export.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// Drafting or rewriting text for a report section from the Ask tab (AS-04):
// asking for it changes nothing (AC1); Insert or Replace saves a version with
// the text as AI draft, back in Needs review, and Undo restores the text
// before (AC2); an unsupported sentence blocks Accept and the export (AC3);
// only the drafting set is cited (AC4); only the assigned engineer, on a
// report neither finalised nor archived (AC5); a section changed since asks
// for the text to be drafted again (AC6). S4 stands in as a stubbed fetch.

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
const ask = `/api/assessments/${REFERENCE}/ask`
const proposals = `/api/assessments/${REFERENCE}/proposals`
const sectionPath = (sectionId: string) => `/api/assessments/${REFERENCE}/sections/${sectionId}`
const BAY_3 = new Types.ObjectId()
const MARKER = '￼'

const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
  { id: '9', title: 'Fire Protection', cope_dimensions: ['Protection'], min_observations: 1 },
]
const event = (e: object) => `data: ${JSON.stringify(e)}\n\n`
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// What S4 is asked, and the stream it answers each question with.
let sent: Record<string, unknown>[] = []
let stream = ''
beforeEach(() => {
  resetChatLimits()
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/assessments/ask')) {
      sent.push(JSON.parse(String(init!.body)))
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS })
  })
})
afterEach(() => vi.unstubAllGlobals())

const RISER = 'Riser penetrations at Level 3 were not fire-stopped.'
const FRAME = 'The building is of steel-framed construction.'
const ROOF = 'The roof is of fire-resistive construction.'
const BARRIER = 'Fire barriers are provided at the riser shafts.'
const COMMON = 'Unsealed risers are common in older buildings.'

type Statement = IReportSection['subsections'][number]['statements'][number]
const statement = (text: string, citations: string[], supported = true): Statement => ({
  text,
  citations,
  supported,
})

const knowledge = (title: string) =>
  KnowledgeDocumentModel.create({
    title,
    issuingBody: 'FM Global',
    standardNumber: title.split(' ').pop(),
    edition: '2026',
    fileName: `${title}.pdf`,
    file: { key: `k/${title}.pdf`, contentType: 'application/pdf', size: 1, sha256: title },
    status: 'complete',
    unconfirmed: [],
    metadata: {
      source_type: 'fm_standard',
      jurisdiction: 'all',
      facility_type: 'all',
      effective_date: new Date('2026-01-01'),
    },
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

// Section 7 drafted from one Construction observation: three findings and a
// table. The drafting set is FM Global 1-21, on the assessment's checklist;
// FM Global 1-1 is not in it.
async function drafted() {
  await UserModel.create([engineer, admin, colleague])
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
  const riser = await ObservationModel.create({
    assessment: assessment._id,
    session: session._id,
    engineer: engineer.name,
    note: 'Riser on L3 not fire-stopped; barriers at the shafts.',
    recordings: [],
    severity: 'high',
    location: BAY_3,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Construction'],
      effective_date: new Date(),
    },
  })
  const inSet = await knowledge('FM Global 1-21')
  const outside = await knowledge('FM Global 1-1')
  await checklist(assessment._id, [{ id: String(inSet._id), title: 'FM Global 1-21' }])
  const cite = `O:${riser._id}`
  const seven = await ReportSectionModel.create({
    assessment: assessment._id,
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [statement(RISER, [cite]), statement(FRAME, [cite]), statement(ROOF, [cite])],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
    ],
    sources: {},
    questions: [],
    evidence: [
      {
        id: String(riser._id),
        COPE_dimension: ['Construction'],
        note: 'Riser on L3 not fire-stopped; barriers at the shafts.',
        transcripts: [],
        severity: 'high',
        location: 'Bay 3, Ground',
        standard: null,
      },
    ],
    guardrail: { passed: true, unsupported_count: 0 },
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
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
  })
  const standardRef = `C:${inSet._id}:3`
  return {
    assessment,
    riser,
    cite,
    seven: String(seven._id),
    inSet: String(inSet._id),
    outside: String(outside._id),
    standardRef,
  }
}
type Seeded = Awaited<ReturnType<typeof drafted>>

// S4's proposal: where it goes, a cited sentence (an observation and a
// standard in the drafting set) and an unsupported one.
function proposalStream(seeded: Seeded, sentences = [BARRIER, COMMON]) {
  const [first, second] = sentences
  const cited = {
    text: first,
    citations: [
      { ref: seeded.cite, kind: 'observation', quote: null, verified: true, described: false },
      {
        ref: seeded.standardRef,
        kind: 'standard',
        quote: 'barriers shall',
        verified: true,
        described: false,
      },
    ],
    supported: true,
    paragraph: 0,
  }
  const bare = { text: second, citations: [], supported: false, paragraph: 0 }
  const sources = {
    [seeded.cite]: { id: String(seeded.riser._id), COPE_dimension: ['Construction'], note: 'x' },
    [seeded.standardRef]: {
      text: 'Fire barriers shall be provided at shafts.',
      doc_id: seeded.inSet,
      headings: ['Barriers'],
      page_start: 3,
      page_end: 3,
    },
  }
  return (
    event({ type: 'step', step: 'retrieve' }) +
    event({ type: 'step', step: 'generate', found: { observations: 1, standards: 1 } }) +
    event({ type: 'target', subsection: 0 }) +
    event({ type: 'statement', ...cited, sources }) +
    event({ type: 'statement', ...bare, sources: {} }) +
    event({
      type: 'result',
      value: {
        statements: [cited, bare],
        missing: [],
        sources,
        confidence: null,
        declined: false,
        error: null,
        target: 0,
        usage: [],
        trace: { story: 'AS-04', provider: 'anthropic', model: 'm', prompt_version: 'as04-v1' },
      },
    })
  )
}

const eventsOf = (text: string) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)))

// Asks for a draft of Section 7 and returns the proposal as the Ask tab gets it.
async function draftSeven(seeded: Seeded, body: object = {}) {
  stream = proposalStream(seeded)
  const res = await asEngineer.post(ask).send({
    question: 'Draft a paragraph on the riser barriers',
    propose: { kind: 'draft', sectionId: '7' },
    ...body,
  })
  expect(res.status).toBe(200)
  return eventsOf(res.text).at(-1).answer.proposal
}

// What the report holds, to show asking changed none of it.
async function reportNow() {
  return JSON.stringify({
    sections: await ReportSectionModel.find().lean(),
    versions: await ReportSectionVersionModel.find().lean(),
    reviews: await ReviewAuditModel.find().lean(),
  })
}
const sevenOf = async () =>
  (await asEngineer.get(`/api/assessments/${REFERENCE}/review`)).body.sections.find(
    (s: { id: string }) => s.id === '7',
  )
// A block of a version's text, by what it is keyed on: a finding or AI text.
type Keyed = { finding?: string | null; ai?: string | null }

const versionsOf = () =>
  ReportSectionVersionModel.find({ sectionId: '7' }).sort({ version: 1 }).lean()

const text = (t: string): DocumentInline => ({ type: 'text', text: t })
const cite = (id: string): DocumentInline => ({ type: 'cite', id })
const finding = (key: string, words: string, ref: string) => ({
  type: 'paragraph' as const,
  finding: key,
  content: [text(words), cite(ref)],
})

describe('asking for text (AC1, AC4)', () => {
  it('drafts from the observations and the drafting set only, and changes nothing in the report', async () => {
    const seeded = await drafted()
    const before = await reportNow()

    const proposal = await draftSeven(seeded)

    const [body] = sent as [Record<string, unknown>]
    expect(body.propose).toEqual({
      kind: 'draft',
      section_id: '7',
      section_title: '7. Construction',
      // A table takes no text.
      subsections: [{ index: 0, heading: 'Construction Narrative' }],
    })
    expect(body.standard_ids).toEqual([seeded.inSet])
    // No past report is named to the model, nor a standard outside the set (AC4).
    expect(body.documents).toEqual([{ id: seeded.inSet, name: 'FM Global 1-21 (2026)' }])
    expect(body.passage).toBeUndefined()

    expect(proposal).toMatchObject({
      kind: 'draft',
      sectionId: '7',
      label: '7. Construction',
      choices: [{ index: 0, heading: 'Construction Narrative' }],
      subsection: 0,
      before: null,
      status: 'proposed',
      inserted: null,
      canUndo: false,
    })
    expect(proposal.sentences.map((s: { supported: boolean }) => s.supported)).toEqual([
      true,
      false,
    ])
    // Kept for the report, with its asker's turn, and the metadata every document has.
    const [kept] = await ReportTextProposalModel.find().lean()
    expect(kept.metadata).toMatchObject({
      source_type: 'report_text_proposal',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: 'Construction',
    })
    expect(kept.base.version).toBe(0)
    const [conversation] = await AssistantConversationModel.find().lean()
    expect(String(conversation.turns[0].proposal)).toBe(String(kept._id))
    // Nothing in the report changed (AC1).
    expect(await reportNow()).toEqual(before)
  })

  it('rewrites the paragraphs a selection is in, sending only what they cite in the drafting set', async () => {
    const seeded = await drafted()
    stream = proposalStream(seeded, [`${FRAME.slice(0, -1)} with steel columns.`, COMMON])
    // The section's text: each finding, then its citation marker.
    const sectionText = [RISER, FRAME, ROOF].map((t) => `${t}${MARKER}`).join('\n')
    const start = sectionText.indexOf('steel-framed')
    const anchor = {
      sectionId: '7',
      start,
      end: start + 'steel-framed'.length,
      exact: 'steel-framed',
      prefix: sectionText.slice(start - 32, start),
      suffix: sectionText.slice(start + 12, start + 44),
    }

    const res = await asEngineer.post(ask).send({
      question: 'Say what the columns are',
      passage: { anchor, citations: [seeded.cite], findings: ['0.1'] },
      propose: { kind: 'rewrite' },
    })

    expect(res.status).toBe(200)
    const [body] = sent as [Record<string, unknown>]
    expect(body.propose).toMatchObject({ kind: 'rewrite', section_id: '7' })
    // The whole paragraph the selection is in, with what it cites.
    expect(body.passage).toMatchObject({ text: FRAME, citations: [seeded.cite], findings: [] })
    const answer = eventsOf(res.text).at(-1).answer
    expect(answer.proposal).toMatchObject({ kind: 'rewrite', before: FRAME, status: 'proposed' })
    expect(answer.passage.anchor).toEqual(anchor)
  })

  it('refuses a rewrite whose text moved, before anything is asked', async () => {
    const seeded = await drafted()
    stream = proposalStream(seeded)
    const res = await asEngineer.post(ask).send({
      question: 'Shorter',
      passage: {
        anchor: { sectionId: '7', start: 0, end: 5, exact: 'Walls', prefix: '', suffix: '' },
        citations: [],
        findings: [],
      },
      propose: { kind: 'rewrite' },
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('moved')
    expect(sent).toEqual([])
  })
})

describe('Insert and Undo (AC2)', () => {
  it('inserts the text at the end of its subsection as AI draft, back in Needs review', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)

    const res = await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    expect(res.status).toBe(200)
    const [version] = await versionsOf()
    expect(version.version).toBe(1)
    expect(version.document.subsections[0].blocks).toEqual([
      finding('0.0', RISER, seeded.cite),
      finding('0.1', FRAME, seeded.cite),
      finding('0.2', ROOF, seeded.cite),
      {
        type: 'paragraph',
        ai: proposal.id,
        content: [text(BARRIER), cite(seeded.cite), cite(seeded.standardRef), text(` ${COMMON}`)],
      },
    ])
    // No finding changed, so nothing was logged.
    expect(await ReviewAuditModel.countDocuments()).toBe(0)
    const seven = res.body.workspace.sections.find((s: { id: string }) => s.id === '7')
    expect(seven.review.state).toBe('needs_review')
    expect(seven.review.aiText).toEqual({ pending: 1, unsupported: 1 })
    expect(seven.review.editedInDocument).toBe(false)
    expect(seven.aiDrafts).toMatchObject([
      {
        id: proposal.id,
        kind: 'draft',
        unsupported: [COMMON],
        insertedBy: { name: engineer.name },
      },
    ])
    // The standard it cites opens like the draft's own.
    expect(seven.sources[seeded.standardRef]).toMatchObject({ kind: 'standard', pageStart: 3 })
    expect(res.body.proposal).toMatchObject({ status: 'inserted', canUndo: true, subsection: 0 })
    // Inserted once only.
    const again = await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})
    expect(again.status).toBe(409)
  })

  it('undoes the insert, restoring the text before it as a new version', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    const res = await asEngineer.post(`${proposals}/${proposal.id}/undo`).send({})

    expect(res.status).toBe(200)
    const [, undone] = await versionsOf()
    expect(undone.version).toBe(2)
    expect(undone.restoredFrom).toBe(`draft:${seeded.seven}`)
    expect(undone.document.subsections[0].blocks).toHaveLength(3)
    const seven = res.body.workspace.sections.find((s: { id: string }) => s.id === '7')
    expect(seven.review.aiText).toEqual({ pending: 0, unsupported: 0 })
    expect(seven.review.state).toBe('ai_draft')
    expect(res.body.proposal).toMatchObject({ status: 'undone', canUndo: false })
  })

  it('replaces the paragraphs of a rewrite; the finding replaced comes back on Undo', async () => {
    const seeded = await drafted()
    stream = proposalStream(seeded, ['The frame is of steel.', COMMON])
    const sectionText = [RISER, FRAME, ROOF].map((t) => `${t}${MARKER}`).join('\n')
    const start = sectionText.indexOf(FRAME)
    const res = await asEngineer.post(ask).send({
      question: 'Shorter',
      passage: {
        anchor: {
          sectionId: '7',
          start,
          end: start + FRAME.length,
          exact: FRAME,
          prefix: sectionText.slice(start - 32, start),
          suffix: sectionText.slice(start + FRAME.length, start + FRAME.length + 32),
        },
        citations: [seeded.cite],
        findings: ['0.1'],
      },
      propose: { kind: 'rewrite' },
    })
    const proposal = eventsOf(res.text).at(-1).answer.proposal
    // Insert is for drafts; a rewrite replaces.
    expect((await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})).status).toBe(409)

    const replaced = await asEngineer.post(`${proposals}/${proposal.id}/replace`).send({})

    expect(replaced.status).toBe(200)
    const [version] = await versionsOf()
    const blocks = version.document.subsections[0].blocks as Keyed[]
    expect(blocks.map((b) => b.finding ?? b.ai)).toEqual(['0.0', proposal.id, '0.2'])
    // The finding replaced left the text, as one deleted in the document editor.
    const [rejected] = await ReviewAuditModel.find().lean()
    expect(rejected).toMatchObject({ finding: '0.1', action: 'reject', inDocument: true })

    const undone = await asEngineer.post(`${proposals}/${proposal.id}/undo`).send({})
    expect(undone.status).toBe(200)
    const actions = (await ReviewAuditModel.find().sort({ sequence: 1 }).lean()).map(
      (e) => e.action,
    )
    expect(actions).toEqual(['reject', 'restore'])
    const seven = undone.body.workspace.sections.find((s: { id: string }) => s.id === '7')
    expect(seven.draft.subsections[0].statements[1].review.state).toBe('pending')
  })
})

describe('unsupported sentences (AC3)', () => {
  it('block Accept and the export until given a source; Delete takes the text out', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    const blockers = (await exportBlockers(REFERENCE)).filter((b) => b.sectionId === '7')
    expect(blockers.map((b) => b.reason)).toEqual(
      expect.arrayContaining([
        '1 AI-drafted sentence has no supporting source. Give it a citation in the document editor, or delete it.',
        'AI-drafted text from the Ask tab is waiting for you to accept it.',
      ]),
    )
    const refused = await asEngineer.post(`${proposals}/${proposal.id}/accept`).send({})
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('unsupported')

    // Given a citation in the document editor, the sentence is supported: Accept.
    const [inserted] = await versionsOf()
    const document = JSON.parse(JSON.stringify(inserted.document)) as SectionDocument
    const ai = document.subsections[0].blocks[3] as { content: DocumentInline[] }
    ai.content.push(cite(seeded.cite))
    const saved = await asEngineer
      .put(`${sectionPath('7')}/document`)
      .send({ baseVersion: 1, draftId: seeded.seven, document })
    expect(saved.status).toBe(200)
    expect((await sevenOf()).review.aiText).toEqual({ pending: 1, unsupported: 0 })

    const accepted = await asEngineer.post(`${proposals}/${proposal.id}/accept`).send({})
    expect(accepted.status).toBe(200)
    const [, , kept] = await versionsOf()
    expect(JSON.stringify(kept.document)).not.toContain('"ai"')
    const seven = accepted.body.workspace.sections.find((s: { id: string }) => s.id === '7')
    expect(seven.review.aiText).toEqual({ pending: 0, unsupported: 0 })
    expect(seven.review.editedInDocument).toBe(true)
    expect(accepted.body.proposal.status).toBe('accepted')
    const left = (await exportBlockers(REFERENCE)).filter((b) => /AI-drafted/.test(b.reason))
    expect(left).toEqual([])
  })

  it('deletes the AI text, and refuses a save naming a proposal never inserted', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    const deleted = await asEngineer.post(`${proposals}/${proposal.id}/delete`).send({})

    expect(deleted.status).toBe(200)
    const [, after] = await versionsOf()
    expect(after.document.subsections[0].blocks).toHaveLength(3)
    expect(deleted.body.proposal.status).toBe('deleted')

    const forged: SectionDocument = JSON.parse(JSON.stringify(after.document))
    forged.subsections[0].blocks.push({
      type: 'paragraph',
      ai: String(new Types.ObjectId()),
      content: [text('Made up.')],
    })
    const res = await asEngineer
      .put(`${sectionPath('7')}/document`)
      .send({ baseVersion: 2, draftId: seeded.seven, document: forged })
    expect(res.status).toBe(400)
  })
})

describe('the drafting set (AC4)', () => {
  it('refuses to insert text citing a standard that has since left the drafting set', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    await checklist(seeded.assessment._id, [{ id: seeded.outside, title: 'FM Global 1-1' }])

    const res = await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('drafting-set')
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
  })
})

describe('who may insert (AC5)', () => {
  it('needs reports:generate and the assigned engineer', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    // A knowledge admin can ask questions, but not for text, nor insert it.
    const asked = await asAdmin.post(ask).send({
      question: 'Draft it',
      propose: { kind: 'draft', sectionId: '7' },
    })
    expect(asked.status).toBe(403)
    for (const action of ['insert', 'replace', 'undo', 'accept', 'delete'])
      expect((await asAdmin.post(`${proposals}/${proposal.id}/${action}`).send({})).status).toBe(
        403,
      )
    // Another engineer cannot open the assessment.
    expect((await asColleague.post(`${proposals}/${proposal.id}/insert`).send({})).status).toBe(403)
    expect(
      (
        await asColleague
          .post(ask)
          .send({ question: 'Draft it', propose: { kind: 'draft', sectionId: '7' } })
      ).status,
    ).toBe(403)
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
  })

  it('answers 409 on a finalised or archived report', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)

    await AssessmentModel.updateOne({ _id: seeded.assessment._id }, { reportStatus: 'finalised' })
    const finalised = await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})
    expect(finalised.status).toBe(409)
    expect(finalised.body.code).toBe('finalised')
    const asked = await asEngineer
      .post(ask)
      .send({ question: 'Draft it', propose: { kind: 'draft', sectionId: '7' } })
    expect(asked.status).toBe(409)

    await AssessmentModel.updateOne(
      { _id: seeded.assessment._id },
      { $unset: { reportStatus: 1 }, archivedAt: new Date() },
    )
    expect((await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})).status).toBe(409)
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
  })
})

describe('a section changed since (AC6)', () => {
  it('asks for the text to be drafted again rather than overwrite the change', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    // The engineer rewords a finding in the review workspace (RV-02).
    const edited = await asEngineer
      .put(`${sectionPath('7')}/findings/0.0`)
      .send({ draftId: seeded.seven, text: 'Riser penetrations at Level 3 were open.' })
    expect(edited.status).toBe(200)

    const res = await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'stale',
      next: 'Draft the text again to start from the section as it is now.',
    })
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
    // Drafted again, it inserts.
    const fresh = await draftSeven(seeded)
    expect((await asEngineer.post(`${proposals}/${fresh.id}/insert`).send({})).status).toBe(200)
  })

  it('keeps Undo from losing a later change', async () => {
    const seeded = await drafted()
    const proposal = await draftSeven(seeded)
    await asEngineer.post(`${proposals}/${proposal.id}/insert`).send({})
    const [inserted] = await versionsOf()
    const document = JSON.parse(JSON.stringify(inserted.document)) as SectionDocument
    document.subsections[0].blocks.push({ type: 'paragraph', content: [text('Mine.')] })
    await asEngineer
      .put(`${sectionPath('7')}/document`)
      .send({ baseVersion: 1, draftId: seeded.seven, document })

    const res = await asEngineer.post(`${proposals}/${proposal.id}/undo`).send({})

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('stale')
  })
})
