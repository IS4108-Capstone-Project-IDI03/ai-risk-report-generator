import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import {
  ImmutableVersionError,
  ReportSectionVersionModel,
  type DocumentInline,
  type SectionDocument,
} from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

useMemoryMongo()

const user = (name: string, staffId: string) => ({
  _id: new Types.ObjectId(),
  staffId,
  name,
  email: `${staffId}@example.com`,
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const engineer = user('Alex Rowe', 'TEST-1')
const api = signedInAs(app, engineer)
const REFERENCE = 'RPT-2026-0411'
const BAY_3 = new Types.ObjectId()
const path = (sectionId: string) => `/api/assessments/${REFERENCE}/sections/${sectionId}/document`
const workspace = async () => (await api.get(`/api/assessments/${REFERENCE}/review`)).body

// S4 stands in as a stubbed fetch, listing the template's sections.
const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
  { id: '9', title: 'Fire Protection', cope_dimensions: ['Protection'], min_observations: 1 },
]
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  vi.stubGlobal('fetch', async () =>
    json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function assessment() {
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
    engineer: engineer._id,
    locations: [{ _id: BAY_3, name: 'Bay 3', floor: 'Ground', key: 'bay 3|ground' }],
  })
  const session = await CaptureSessionModel.create({ assessment: created._id })
  return { assessment: created, session }
}

type Statement = IReportSection['subsections'][number]['statements'][number]
const statement = (text: string, citations: string[], supported = true): Statement => ({
  text,
  citations,
  supported,
})

// Section 7 drafted from one Construction observation, the same now as when
// drafted: three findings, the third citing nothing, and a table. Section 9
// has no draft.
async function drafted() {
  const { assessment: a, session } = await assessment()
  const riser = await ObservationModel.create({
    assessment: a._id,
    session: session._id,
    engineer: engineer.name,
    note: 'Riser on L3 not fire-stopped.',
    recordings: [],
    severity: 'high',
    location: BAY_3,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: ['Construction' as CopeDimension],
      effective_date: new Date(),
    },
  })
  const cite = `O:${riser._id}`
  const seven = await ReportSectionModel.create({
    assessment: a._id,
    sectionId: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [
          statement('Riser penetrations at Level 3 were not fire-stopped.', [cite]),
          statement('The building is of steel-framed construction.', [cite]),
          statement('The roof is of fire-resistive construction.', [], false),
        ],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
    ],
    sources: {},
    questions: [],
    evidence: [
      {
        id: String(riser._id),
        COPE_dimension: ['Construction'],
        note: 'Riser on L3 not fire-stopped.',
        transcripts: [],
        severity: 'high',
        location: 'Bay 3, Ground',
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
      COPE_dimension: 'Construction',
      effective_date: new Date(),
    },
  })
  return { assessment: a, seven: String(seven._id), cite }
}

const text = (t: string, marks?: ('bold' | 'italic' | 'underline')[]): DocumentInline => ({
  type: 'text',
  text: t,
  ...(marks && { marks }),
})
const citation = (id: string): DocumentInline => ({ type: 'cite', id })
const paragraph = (content: DocumentInline[], finding?: string) => ({
  type: 'paragraph' as const,
  ...(finding && { finding }),
  content,
})

// Section 7 as the editor first shows it: each finding as drafted, then its
// citation markers, in the narrative subsection; nothing in the table.
function asDrafted(cite: string): SectionDocument {
  return {
    intro: [],
    subsections: [
      {
        heading: 'Construction Narrative',
        blocks: [
          paragraph(
            [text('Riser penetrations at Level 3 were not fire-stopped.'), citation(cite)],
            '0.0',
          ),
          paragraph([text('The building is of steel-framed construction.'), citation(cite)], '0.1'),
          paragraph([text('The roof is of fire-resistive construction.')], '0.2'),
        ],
      },
      { heading: 'Construction Table', blocks: [] },
    ],
  }
}
// The same with one finding's paragraph replaced, or left out with null.
function withFinding(cite: string, key: string, replacement: ReturnType<typeof paragraph> | null) {
  const document = asDrafted(cite)
  const blocks = document.subsections[0].blocks
  const index = blocks.findIndex((b) => b.type === 'paragraph' && b.finding === key)
  if (replacement) blocks[index] = replacement
  else blocks.splice(index, 1)
  return document
}

type Finding = {
  text: string
  citations: string[]
  supported: boolean
  citationsRemoved: string[]
  review: { state: string }
}
type Section = {
  id: string
  review: { state: string; unsupportedStatements: number; editedInDocument: boolean }
  completion: { state: string; written: number; total: number }
  draft: { subsections: { statements: Finding[] }[] } | null
  document: { version: number; current: boolean; document: SectionDocument } | null
  history: { action: string; finding: string; inDocument: boolean; before: string; after: string }[]
}
const sectionOf = (body: { sections: Section[] }, id: string) =>
  body.sections.find((s) => s.id === id)!
const findingsOf = (section: Section) => section.draft!.subsections[0].statements

describe('saving the report from the document editor (RV-08)', () => {
  it('saves text written into a section that was not drafted, kept as its newest version (AC3, AC13, AC15)', async () => {
    await drafted()
    const document: SectionDocument = {
      intro: [
        { type: 'heading', content: [text('Sprinklers')] },
        paragraph([text('The warehouse is fully sprinklered.', ['bold'])]),
        {
          type: 'bulletList',
          items: [paragraph([text('Wet pipe')]), paragraph([text('ESFR in racking')])],
        },
      ],
      subsections: [],
    }

    const saved = await api.put(path('9')).send({ baseVersion: 0, draftId: null, document })

    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({
      version: 1,
      draftId: null,
      document,
      savedBy: { id: String(engineer._id), name: 'Alex Rowe' },
    })
    expect(Date.parse(saved.body.savedAt)).not.toBeNaN()

    // Reopened, the section holds the text, written by the engineer (AC15).
    const nine = sectionOf(await workspace(), '9')
    expect(nine.document).toMatchObject({ version: 1, current: true, document })
    expect(nine.review.state).toBe('edited')
    expect(nine.completion.state).toBe('complete')
    // Nothing is decided on a section with no draft.
    expect(await ReviewAuditModel.countDocuments()).toBe(0)
  })

  it('records a finding edited in place as an edit by the engineer, which ends its AI draft state (AC4, AC12)', async () => {
    const { seven, cite } = await drafted()
    const after = 'The building is a single-storey steel portal frame.'

    const saved = await api.put(path('7')).send({
      baseVersion: 0,
      draftId: seven,
      document: withFinding(
        cite,
        '0.1',
        paragraph(
          [
            text('The building is a '),
            text('single-storey', ['italic']),
            text(' steel portal frame.'),
            citation(cite),
          ],
          '0.1',
        ),
      ),
    })

    expect(saved.status).toBe(200)
    const section = sectionOf(await workspace(), '7')
    const [, edited] = findingsOf(section)
    expect(edited).toMatchObject({ text: after, citations: [cite], review: { state: 'edited' } })
    // The section is Edited by you, unless something in it is flagged: here the
    // third finding still cites nothing, so it needs review, edited by the engineer.
    expect(section.review).toMatchObject({ state: 'needs_review', editedInDocument: true })
    expect(section.history[0]).toMatchObject({
      action: 'edit',
      finding: '0.1',
      inDocument: true,
      before: 'The building is of steel-framed construction.',
      after,
    })
    // The draft itself is never changed.
    const draft = await ReportSectionModel.findById(seven).lean()
    expect(draft!.subsections[0].statements[1].text).toBe(
      'The building is of steel-framed construction.',
    )
  })

  it('makes a section Edited by you once nothing in it is flagged (AC12)', async () => {
    const { seven, cite } = await drafted()
    // The unsupported third finding is deleted from the document, so rejected.
    const document = withFinding(cite, '0.2', null)
    document.subsections[0].blocks[0] = paragraph(
      [text('Riser penetrations at Level 3 were found not fire-stopped.'), citation(cite)],
      '0.0',
    )

    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document })

    const section = sectionOf(await workspace(), '7')
    expect(section.review.state).toBe('edited')
    expect(findingsOf(section).map((f) => f.review.state)).toEqual([
      'edited',
      'pending',
      'rejected',
    ])
  })

  it('keeps a citation marker with its source when the text around it changes (AC9)', async () => {
    const { seven, cite } = await drafted()

    await api.put(path('7')).send({
      baseVersion: 0,
      draftId: seven,
      document: withFinding(
        cite,
        '0.0',
        paragraph(
          [text('Riser penetrations at'), citation(cite), text(' Level 3 lack fire-stopping.')],
          '0.0',
        ),
      ),
    })

    const [first] = findingsOf(sectionOf(await workspace(), '7'))
    expect(first).toMatchObject({
      text: 'Riser penetrations at Level 3 lack fire-stopping.',
      citations: [cite],
      supported: true,
      citationsRemoved: [],
    })
  })

  it('flags the claim unsupported once its citation marker is deleted, and clears it when put back (AC10)', async () => {
    const { seven, cite } = await drafted()
    const without = withFinding(
      cite,
      '0.0',
      paragraph([text('Riser penetrations at Level 3 were not fire-stopped.')], '0.0'),
    )

    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document: without })

    let section = sectionOf(await workspace(), '7')
    expect(findingsOf(section)[0]).toMatchObject({
      supported: false,
      citations: [],
      citationsRemoved: [cite],
    })
    expect(section.review).toMatchObject({ state: 'needs_review', unsupportedStatements: 2 })

    // Undone and saved again, the marker is back and the claim supported.
    await api.put(path('7')).send({ baseVersion: 1, draftId: seven, document: asDrafted(cite) })
    section = sectionOf(await workspace(), '7')
    expect(findingsOf(section)[0]).toMatchObject({ supported: true, citationsRemoved: [] })
    expect(section.review.unsupportedStatements).toBe(1)
  })

  it('keeps an unsupported finding flagged when its text is edited (AC11)', async () => {
    const { seven, cite } = await drafted()

    await api.put(path('7')).send({
      baseVersion: 0,
      draftId: seven,
      document: withFinding(
        cite,
        '0.2',
        paragraph([text('The roof is of non-combustible construction.')], '0.2'),
      ),
    })

    const section = sectionOf(await workspace(), '7')
    expect(findingsOf(section)[2]).toMatchObject({
      text: 'The roof is of non-combustible construction.',
      supported: false,
      review: { state: 'edited' },
    })
    expect(section.review).toMatchObject({ state: 'needs_review', unsupportedStatements: 1 })
  })

  it('rejects a finding deleted from the document, which can be restored from the review history', async () => {
    const { seven, cite } = await drafted()

    await api
      .put(path('7'))
      .send({ baseVersion: 0, draftId: seven, document: withFinding(cite, '0.1', null) })

    expect(findingsOf(sectionOf(await workspace(), '7'))[1].review.state).toBe('rejected')
    expect(await ReviewAuditModel.findOne({ finding: '0.1' }).lean()).toMatchObject({
      action: 'reject',
      inDocument: true,
      before: 'The building is of steel-framed construction.',
    })
    const restored = await api
      .post(`/api/assessments/${REFERENCE}/sections/7/findings/0.1/restore`)
      .send({ draftId: seven })
    expect(findingsOf(sectionOf(restored.body, '7'))[1].review.state).toBe('pending')
  })

  it('logs a change of formatting alone, and nothing for a save that changes nothing', async () => {
    const { seven, cite } = await drafted()

    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document: asDrafted(cite) })
    expect(await ReviewAuditModel.countDocuments()).toBe(0)

    const bold = withFinding(
      cite,
      '0.1',
      paragraph(
        [
          text('The building is of '),
          text('steel-framed', ['bold']),
          text(' construction.'),
          citation(cite),
        ],
        '0.1',
      ),
    )
    await api.put(path('7')).send({ baseVersion: 1, draftId: seven, document: bold })
    await api.put(path('7')).send({ baseVersion: 2, draftId: seven, document: bold })

    const entries = await ReviewAuditModel.find().lean()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: 'edit', finding: '0.1', inDocument: true })
    expect(await ReportSectionVersionModel.countDocuments()).toBe(3)
  })

  it('logs a finding set as a sub-heading as an edit, keeping it the same finding (AC6, AC12)', async () => {
    const { seven, cite } = await drafted()
    const document = asDrafted(cite)
    document.subsections[0].blocks[1] = {
      type: 'heading',
      finding: '0.1',
      content: [text('The building is of steel-framed construction.'), citation(cite)],
    }

    expect(
      (await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document })).status,
    ).toBe(200)

    const entries = await ReviewAuditModel.find().lean()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'edit',
      finding: '0.1',
      inDocument: true,
      after: 'The building is of steel-framed construction.',
      citationsAfter: [cite],
    })
    const section = sectionOf(await workspace(), '7')
    expect(findingsOf(section)[1]).toMatchObject({ supported: true, review: { state: 'edited' } })
    // Still flagged by the unsupported third finding, and edited by the engineer.
    expect(section.review).toMatchObject({ state: 'needs_review', editedInDocument: true })
    expect(section.document!.document.subsections[0].blocks[1]).toEqual(
      document.subsections[0].blocks[1],
    )

    // Saved again as it stands, nothing more is logged.
    await api.put(path('7')).send({ baseVersion: 1, draftId: seven, document })
    expect(await ReviewAuditModel.countDocuments()).toBe(1)
  })

  it('keeps text written between findings with the version, making the subsection written', async () => {
    const { seven, cite } = await drafted()
    const document = asDrafted(cite)
    document.subsections[0].blocks.splice(1, 0, paragraph([text('Fire stopping was ongoing.')]))

    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document })

    const section = sectionOf(await workspace(), '7')
    expect(section.document!.document.subsections[0].blocks[1]).toEqual(
      paragraph([text('Fire stopping was ongoing.')]),
    )
    expect(section.completion).toMatchObject({ written: 1, total: 1 })
  })

  it('saves what the engineer adds to Sections 1, 2, 3 and Appendix A', async () => {
    await drafted()
    const document: SectionDocument = {
      intro: [paragraph([text('The client asked for a second visit in May.')])],
      subsections: [],
    }
    for (const id of ['1', '2', '3', 'A']) {
      const saved = await api.put(path(id)).send({ baseVersion: 0, draftId: null, document })
      expect(saved.status).toBe(200)
    }
    const { parts } = await workspace()
    expect(parts['1']).toMatchObject({ version: 1, current: true, document })
    expect(parts.A).toMatchObject({ version: 1, current: true, document })
  })

  it('refuses a save built on an older version or an older draft, so nothing is overwritten (409)', async () => {
    const { seven, cite } = await drafted()
    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document: asDrafted(cite) })

    const older = await api
      .put(path('7'))
      .send({ baseVersion: 0, draftId: seven, document: asDrafted(cite) })
    expect(older.status).toBe(409)
    expect(older.body.error).toMatch(/saved from somewhere else/)

    const otherDraft = await api
      .put(path('7'))
      .send({ baseVersion: 1, draftId: String(new Types.ObjectId()), document: asDrafted(cite) })
    expect(otherDraft.status).toBe(409)
    expect(await ReportSectionVersionModel.countDocuments()).toBe(1)
  })

  it('refuses a document that does not fit the section (400)', async () => {
    const { seven, cite } = await drafted()
    const send = (document: unknown) =>
      api.put(path('7')).send({ baseVersion: 0, draftId: seven, document })

    const renamed = asDrafted(cite)
    renamed.subsections[0].heading = 'My heading'
    expect((await send(renamed)).status).toBe(400)

    const intoTable = asDrafted(cite)
    intoTable.subsections[1].blocks.push(paragraph([text('Steel frame.')]))
    expect((await send(intoTable)).body.error).toMatch(/table filled from measured values/)

    const twice = asDrafted(cite)
    twice.subsections[0].blocks.push(paragraph([text('Again.')], '0.0'))
    expect((await send(twice)).status).toBe(400)

    expect((await send({ intro: [{ type: 'image' }], subsections: [] })).status).toBe(400)
    expect(await ReportSectionVersionModel.countDocuments()).toBe(0)
  })

  it('lets only the assigned engineer save (403), for a section the report has (404)', async () => {
    const { seven, cite } = await drafted()
    const body = { baseVersion: 0, draftId: seven, document: asDrafted(cite) }

    const other = signedInAs(app, user('Sam Lee', 'TEST-2'))
    expect((await other.put(path('7')).send(body)).status).toBe(403)
    expect((await signedInAsRole(app, 'knowledge_admin').put(path('7')).send(body)).status).toBe(
      403,
    )
    expect((await api.put(path('13')).send(body)).status).toBe(404)
  })

  it('never changes or deletes a saved version', async () => {
    await drafted()
    await api
      .put(path('9'))
      .send({ baseVersion: 0, draftId: null, document: { intro: [], subsections: [] } })

    await expect(
      ReportSectionVersionModel.updateOne({}, { $set: { version: 9 } }),
    ).rejects.toBeInstanceOf(ImmutableVersionError)
    await expect(ReportSectionVersionModel.deleteMany({})).rejects.toBeInstanceOf(
      ImmutableVersionError,
    )
  })

  it('sets a version aside once the section is drafted again', async () => {
    const { seven, cite, assessment: a } = await drafted()
    const document = asDrafted(cite)
    document.subsections[0].blocks.push(paragraph([text('Written by the engineer.')]))
    await api.put(path('7')).send({ baseVersion: 0, draftId: seven, document })

    const draft = await ReportSectionModel.findById(seven).lean()
    const { _id, createdAt, updatedAt, ...copy } = draft!
    void _id
    void createdAt
    void updatedAt
    await ReportSectionModel.create({ ...copy, assessment: a._id })

    const section = sectionOf(await workspace(), '7')
    expect(section.document).toMatchObject({ version: 1, current: false })
    expect(section.review.state).not.toBe('edited')
  })
})
