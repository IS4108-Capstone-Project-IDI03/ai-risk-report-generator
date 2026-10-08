import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
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

// S4 stands in as a stubbed fetch giving the template's sections.
const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
  { id: '9', title: 'Fire Protection', cope_dimensions: ['Protection'], min_observations: 1 },
  { id: '10', title: 'External Exposures', cope_dimensions: ['Exposure'], min_observations: 1 },
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
    standards: ['FM Global 2-0'],
    engineer: engineer._id,
    locations: [{ _id: BAY_3, name: 'Bay 3', floor: 'Ground', key: 'bay 3|ground' }],
  })
  const session = await CaptureSessionModel.create({ assessment: created._id })
  return { assessment: created, session }
}

async function observation(
  ids: { assessment: Types.ObjectId; session: Types.ObjectId },
  copeDimension: CopeDimension,
  note: string,
) {
  return ObservationModel.create({
    assessment: ids.assessment,
    session: ids.session,
    engineer: engineer.name,
    note,
    recordings: [],
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

// A knowledge document as the ingestion worker leaves it (IN-01, KB-01).
async function knowledgeDocument(fields: {
  title: string
  sourceType: 'fm_standard' | 'nfpa_standard' | 'marsh_report'
  edition?: string
  effectiveDate: string
  withdrawn?: boolean
}) {
  return KnowledgeDocumentModel.create({
    title: fields.title,
    issuingBody: { fm_standard: 'FM Global', nfpa_standard: 'NFPA', marsh_report: 'Marsh' }[
      fields.sourceType
    ],
    edition: fields.edition,
    fileName: `${fields.title}.pdf`,
    // The title doubles as the fingerprint: stored files must differ (IN-07 index).
    file: {
      key: 'knowledge/x.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: fields.title,
    },
    status: 'complete',
    metadata: {
      source_type: fields.sourceType,
      jurisdiction: 'all',
      facility_type: 'all',
      COPE_dimension: 'all',
      effective_date: new Date(fields.effectiveDate),
    },
    withdrawn: fields.withdrawn
      ? { at: new Date('2026-10-04T02:00:00Z'), by: { id: 'admin', name: 'Sana Patel' } }
      : undefined,
  })
}

type Evidence = IReportSection['evidence'][number]
const evidence = (id: unknown, COPE_dimension: CopeDimension, note: string): Evidence => ({
  id: String(id),
  COPE_dimension,
  note,
  transcripts: [],
  severity: 'high',
  location: 'Bay 3, Ground',
  standard: null,
})

// A saved draft of a section, as GN-01 leaves it.
async function draft(
  assessmentId: Types.ObjectId,
  sectionId: string,
  fields: Pick<IReportSection, 'subsections' | 'sources' | 'evidence'>,
) {
  return ReportSectionModel.create({
    assessment: assessmentId,
    sectionId,
    title: SECTIONS.find((s) => s.id === sectionId)!.title,
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
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
    ...fields,
  })
}

describe('the review workspace (RV-01)', () => {
  it("shows each draft beside its cited passages, their documents' details and its observations", async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    const riser = await observation(ids, 'Construction', 'Riser on L3 not fire-stopped.')
    const sprinklers = await observation(ids, 'Protection', 'Heads under the mezzanine.')
    const pumps = await observation(ids, 'Protection', 'Pump churn logs up to date.')
    const standard = await knowledgeDocument({
      title: 'FM Global Data Sheet 1-21',
      sourceType: 'fm_standard',
      edition: '2022',
      effectiveDate: '2022-04-01',
    })
    const report = await knowledgeDocument({
      title: 'Jurong Logistics Hub PRE 2024',
      sourceType: 'marsh_report',
      effectiveDate: '2024-03-12',
    })
    await draft(a._id, '7', {
      subsections: [
        {
          heading: 'Construction Narrative',
          kind: 'narrative',
          statements: [
            {
              text: 'Riser penetrations were not fire-stopped at Level 3.',
              citations: [`O:${riser._id}`, `C:${standard._id}:4`, `O:${sprinklers._id}`],
              supported: true,
            },
            {
              text: 'The building is of fire-resistive construction.',
              citations: [`P:${report._id}:9`],
              supported: false,
            },
          ],
        },
        { heading: 'Construction Table', kind: 'table', statements: [] },
        { heading: 'Details on Combustible Construction', kind: 'narrative', statements: [] },
      ],
      sources: {
        [`C:${standard._id}:4`]: {
          text: 'Fire-stop all penetrations of rated assemblies.',
          doc_id: String(standard._id),
          headings: ['Fire stopping', 'Penetrations'],
          page_start: 12,
          page_end: 13,
          source_type: 'fm_standard',
        },
        [`P:${report._id}:9`]: {
          text: 'The building is of fire-resistive construction.',
          doc_id: String(report._id),
          headings: ['Property Risk Evaluation Report', 'Construction'],
          page_start: 6,
        },
      },
      evidence: [
        evidence(riser._id, 'Construction', 'Riser on L3 not fire-stopped.'),
        evidence(sprinklers._id, 'Protection', 'Heads under the mezzanine.'),
        evidence(pumps._id, 'Protection', 'Pump churn logs up to date.'),
      ],
    })

    const response = await api.get(`/api/assessments/${REFERENCE}/review`)

    expect(response.status).toBe(200)
    const [construction, fire, exposures] = response.body.sections
    expect(construction).toMatchObject({ id: '7', title: 'Construction' })
    // One of two prose subsections is written; the table is left to GN-03 (AC5).
    expect(construction.completion).toEqual({
      state: 'partial',
      written: 1,
      total: 2,
      tables: 1,
    })
    // The past-report statement cannot be supported, so the section needs review (AC6).
    expect(construction.review).toEqual({
      state: 'needs_review',
      unsupportedStatements: 1,
      withdrawnSources: 0,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    })
    expect(construction.draft.subsections[0].statements).toHaveLength(2)
    expect(construction.draft.sources).toBeUndefined()

    // A cited standard opens as the exact passage, with its page and its
    // document's title, edition and effective date (AC7-AC11).
    expect(construction.sources[`C:${standard._id}:4`]).toEqual({
      id: `C:${standard._id}:4`,
      kind: 'standard',
      text: 'Fire-stop all penetrations of rated assemblies.',
      headings: ['Fire stopping', 'Penetrations'],
      pageStart: 12,
      pageEnd: 13,
      documentId: String(standard._id),
      document: {
        title: 'FM Global Data Sheet 1-21',
        issuingBody: 'FM Global',
        sourceType: 'fm_standard',
        edition: '2022',
        effectiveDate: '2022-04-01',
        withdrawnAt: null,
        fileUrl: `/api/knowledge-documents/${standard._id}/file`,
      },
    })
    // A cited past report opens the same way; it has no edition.
    expect(construction.sources[`P:${report._id}:9`]).toMatchObject({
      kind: 'precedent',
      pageStart: 6,
      pageEnd: null,
      document: { title: 'Jurong Logistics Hub PRE 2024', edition: null },
    })

    // The section's own observation and the one from another category it
    // cites, as drafted from; not the uncited one from another category (AC3).
    expect(construction.observations).toEqual([
      {
        id: String(riser._id),
        copeDimension: 'Construction',
        note: 'Riser on L3 not fire-stopped.',
        transcripts: [],
        severity: 'high',
        location: 'Bay 3, Ground',
        standard: null,
      },
      expect.objectContaining({ id: String(sprinklers._id), copeDimension: 'Protection' }),
    ])

    // Sections without a draft are not started and not drafted.
    for (const section of [fire, exposures]) {
      expect(section).toMatchObject({
        completion: { state: 'not_started' },
        review: { state: 'not_drafted' },
        draft: null,
        sources: {},
        observations: [],
      })
    }
  })

  it('marks a draft citing a withdrawn source, or missing newer evidence, as needing review', async () => {
    const { assessment: a, session } = await assessment()
    const ids = { assessment: a._id, session: session._id }
    const riser = await observation(ids, 'Construction', 'Riser not fire-stopped.')
    const sprinklers = await observation(ids, 'Protection', 'Heads under the mezzanine.')
    const withdrawn = await knowledgeDocument({
      title: 'NFPA 25',
      sourceType: 'nfpa_standard',
      edition: '2020',
      effectiveDate: '2020-01-01',
      withdrawn: true,
    })
    const statement = (citations: string[]) => ({ text: 'Stated.', citations, supported: true })
    // Every draft is given every categorised observation (GN-01).
    const given = [
      evidence(riser._id, 'Construction', 'Riser not fire-stopped.'),
      evidence(sprinklers._id, 'Protection', 'Heads under the mezzanine.'),
    ]
    await draft(a._id, '7', {
      subsections: [
        {
          heading: 'Construction Narrative',
          kind: 'narrative',
          statements: [statement([`O:${riser._id}`])],
        },
      ],
      sources: {},
      evidence: given,
    })
    await draft(a._id, '9', {
      subsections: [
        {
          heading: 'Sprinkler Protection',
          kind: 'narrative',
          statements: [statement([`O:${sprinklers._id}`, `C:${withdrawn._id}:2`])],
        },
      ],
      sources: {
        // No doc_id: the chunk ID names the document.
        [`C:${withdrawn._id}:2`]: { text: 'Inspect control valves weekly.', page_start: 3 },
      },
      evidence: given,
    })

    const fresh = (await api.get(`/api/assessments/${REFERENCE}/review`)).body.sections
    // Fully written, every citation resolves, nothing changed: an AI draft to review.
    expect(fresh[0].completion).toMatchObject({ state: 'complete', written: 1, total: 1 })
    expect(fresh[0].review).toEqual({
      state: 'ai_draft',
      unsupportedStatements: 0,
      withdrawnSources: 0,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    })
    // Only the section's own observation shows, since the other is not cited.
    expect(fresh[0].observations.map((o: { id: string }) => o.id)).toEqual([String(riser._id)])
    // A cited source withdrawn after drafting is labelled and flags the section (AC12).
    expect(fresh[1].sources[`C:${withdrawn._id}:2`].document).toMatchObject({
      title: 'NFPA 25',
      withdrawnAt: '2026-10-04T02:00:00.000Z',
    })
    expect(fresh[1].review).toMatchObject({ state: 'needs_review', withdrawnSources: 1 })

    // An observation added after drafting makes the draft out of date.
    await observation(ids, 'Construction', 'Curtain wall sealed.')
    const later = (await api.get(`/api/assessments/${REFERENCE}/review`)).body.sections
    expect(later[0].review).toMatchObject({
      state: 'needs_review',
      changesSinceDraft: 1,
      changeCounts: { added: 1, changed: 0, removed: 0 },
    })
  })

  it('shows the newest draft, and a passage whose document has no record', async () => {
    const { assessment: a } = await assessment()
    const subsections = (text: string) => [
      {
        heading: 'Construction Narrative',
        kind: 'narrative' as const,
        statements: [{ text, citations: ['C:legacy-doc:1'], supported: true }],
      },
    ]
    await draft(a._id, '7', { subsections: subsections('First draft.'), sources: {}, evidence: [] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await draft(a._id, '7', {
      subsections: subsections('Second draft.'),
      sources: { 'C:legacy-doc:1': { text: 'A passage.', doc_id: 'legacy-doc' } },
      evidence: [],
    })

    const [construction] = (await api.get(`/api/assessments/${REFERENCE}/review`)).body.sections

    expect(construction.draft.subsections[0].statements[0].text).toBe('Second draft.')
    expect(construction.sources['C:legacy-doc:1']).toMatchObject({
      documentId: 'legacy-doc',
      document: null,
      pageStart: null,
      headings: [],
    })
  })

  it('opens for anyone who can read the assessment, and reports what it cannot find', async () => {
    await assessment()
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`/api/assessments/${REFERENCE}/review`)).status).toBe(200)
    expect((await api.get('/api/assessments/RPT-2026-9999/review')).status).toBe(404)

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const down = await api.get(`/api/assessments/${REFERENCE}/review`)
    expect(down.status).toBe(503)
    expect(down.body.error).toBe('The drafting service could not be reached.')
  })
})
