import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import {
  ReportSectionVersionModel,
  type DocumentInline,
  type SectionDocument,
} from '../models/report-section-version.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs, signedInAsRole } from './auth-test-helpers'

// A report section's version history (RV-06): listing its AI drafts and the
// versions saved in the document editor, and restoring one of them.

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
const sectionPath = (sectionId: string) => `/api/assessments/${REFERENCE}/sections/${sectionId}`
const workspace = async () => (await api.get(`/api/assessments/${REFERENCE}/review`)).body
const save = (sectionId: string, body: object) =>
  api.put(`${sectionPath(sectionId)}/document`).send(body)
const restore = (sectionId: string, body: object) =>
  api.post(`${sectionPath(sectionId)}/versions/restore`).send(body)
const history = async (sectionId: string): Promise<History> =>
  (await api.get(`${sectionPath(sectionId)}/versions`)).body
// Saves made in the same millisecond would tie on time.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

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
  await UserModel.create(engineer)
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

const RISER = 'Riser penetrations at Level 3 were not fire-stopped.'
const FRAME = 'The building is of steel-framed construction.'
const ROOF = 'The roof is of fire-resistive construction.'

// Section 7 drafted from one Construction observation: three findings, the
// third citing nothing, and a table. Section 9 has no draft.
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
          statement(RISER, [cite]),
          statement(FRAME, [cite]),
          statement(ROOF, [], false),
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
  await tick()
  return { assessment: a, seven: String(seven._id), cite }
}

const text = (t: string): DocumentInline => ({ type: 'text', text: t })
const citation = (id: string): DocumentInline => ({ type: 'cite', id })
const paragraph = (content: DocumentInline[], finding?: string) => ({
  type: 'paragraph' as const,
  ...(finding && { finding }),
  content,
})

// Section 7 as the editor first shows it, and as its AI draft reads.
function asDrafted(cite: string): SectionDocument {
  return {
    intro: [],
    subsections: [
      {
        heading: 'Construction Narrative',
        blocks: [
          paragraph([text(RISER), citation(cite)], '0.0'),
          paragraph([text(FRAME), citation(cite)], '0.1'),
          paragraph([text(ROOF)], '0.2'),
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
// Text written into a part with no draft.
const written = (words: string): SectionDocument => ({
  intro: [paragraph([text(words)])],
  subsections: [],
})

type Entry = {
  id: string
  kind: string
  version: number | null
  origin: string
  onSavedDraft: boolean
  restoredFrom: string | null
  document: SectionDocument
  at: string
  by: { id: string; name: string } | null
  model: string | null
}
type History = { entries: Entry[]; latestVersion: number; savedDraftId: string | null }
type Finding = { text: string; review: { state: string } }
type Section = {
  id: string
  draft: { subsections: { statements: Finding[] }[] } | null
  document: { version: number; current: boolean; document: SectionDocument } | null
  history: { action: string; finding: string | null; restoredFrom: string | null }[]
}
const sectionOf = (body: { sections: Section[] }, id: string) =>
  body.sections.find((s) => s.id === id)!
const findingsOf = (section: Section) => section.draft!.subsections[0].statements

describe('a section’s version history (RV-06)', () => {
  it('lists the AI draft and every saved version oldest first, each with who made it and when (AC1, AC2)', async () => {
    const { seven, cite } = await drafted()
    await save('7', { baseVersion: 0, draftId: seven, document: asDrafted(cite) })
    await tick()
    const reworded = withFinding(
      cite,
      '0.1',
      paragraph([text('The building is a steel portal frame.'), citation(cite)], '0.1'),
    )
    await save('7', { baseVersion: 1, draftId: seven, document: reworded })

    const res = await api.get(`${sectionPath('7')}/versions`)

    expect(res.status).toBe(200)
    const { entries, latestVersion, savedDraftId } = res.body as History
    expect(entries.map((e) => e.id)).toEqual([`draft:${seven}`, 'version:1', 'version:2'])
    const times = entries.map((e) => Date.parse(e.at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    // The AI draft: what the model wrote, for whom.
    expect(entries[0]).toMatchObject({
      kind: 'draft',
      version: null,
      origin: 'drafted',
      model: 'claude-opus-5-5',
      by: { id: String(engineer._id), name: 'Alex Rowe' },
      onSavedDraft: true,
      document: asDrafted(cite),
    })
    // Each save: its text, who saved it and when.
    expect(entries[2]).toMatchObject({
      kind: 'version',
      version: 2,
      origin: 'saved',
      restoredFrom: null,
      by: { id: String(engineer._id), name: 'Alex Rowe' },
      onSavedDraft: true,
      document: reworded,
    })
    expect(latestVersion).toBe(2)
    expect(savedDraftId).toBe(seven)
  })

  it('restores an earlier version as the section’s draft, bringing back its findings, and keeps it on reopening (AC6, AC8)', async () => {
    const { seven, cite } = await drafted()
    const first = 'The building is a steel portal frame.'
    const v1 = withFinding(cite, '0.1', paragraph([text(first), citation(cite)], '0.1'))
    await save('7', { baseVersion: 0, draftId: seven, document: v1 })
    await tick()
    // Overwritten during review: the finding reworded again, and the first deleted.
    const v2 = withFinding(
      cite,
      '0.1',
      paragraph([text('The building is concrete.'), citation(cite)], '0.1'),
    )
    v2.subsections[0].blocks.splice(0, 1)
    await save('7', { baseVersion: 1, draftId: seven, document: v2 })
    expect(findingsOf(sectionOf(await workspace(), '7')).map((f) => f.review.state)).toEqual([
      'rejected',
      'edited',
      'pending',
    ])

    const restored = await restore('7', { baseVersion: 2, draftId: seven, from: 'version:1' })

    expect(restored.status).toBe(200)
    expect(restored.body.version).toMatchObject({
      version: 3,
      draftId: seven,
      restoredFrom: 'version:1',
      document: v1,
      savedBy: { name: 'Alex Rowe' },
    })
    // Its content is the section's draft again (AC6): the deleted finding is
    // back as it was, the reworded one in the version's words.
    const after = sectionOf(restored.body.workspace, '7')
    expect(after.document).toMatchObject({ version: 3, current: true, document: v1 })
    const [riser, frame, roof] = findingsOf(after)
    expect(riser).toMatchObject({ text: RISER, review: { state: 'pending' } })
    expect(frame).toMatchObject({ text: first, review: { state: 'edited' } })
    expect(roof.review.state).toBe('pending')
    // Each change is a review decision naming the version restored.
    const entries = await ReviewAuditModel.find({ restoredFrom: 'version:1' })
      .sort({ finding: 1 })
      .lean()
    expect(entries.map((e) => [e.finding, e.action, e.inDocument])).toEqual([
      ['0.0', 'restore', true],
      ['0.1', 'edit', true],
    ])
    expect(after.history[0]).toMatchObject({ restoredFrom: 'version:1' })
    // The draft itself is never changed.
    const draft = await ReportSectionModel.findById(seven).lean()
    expect(draft!.subsections[0].statements.map((s) => s.text)).toEqual([RISER, FRAME, ROOF])

    // Reopened, the restored text stays (AC8), and what it replaced is a version too.
    const reopened = sectionOf(await workspace(), '7')
    expect(reopened.document).toMatchObject({ version: 3, current: true, document: v1 })
    expect(findingsOf(reopened)[1].text).toBe(first)
    const listed = await history('7')
    expect(listed.entries.map((e) => e.id)).toEqual([
      `draft:${seven}`,
      'version:1',
      'version:2',
      'version:3',
    ])
    expect(listed.entries[3]).toMatchObject({ origin: 'restored', restoredFrom: 'version:1' })
  })

  it('leaves every other section’s content unchanged (AC7)', async () => {
    const { seven, cite } = await drafted()
    await save('9', { baseVersion: 0, draftId: null, document: written('Sprinklers throughout.') })
    await save('1', { baseVersion: 0, draftId: null, document: written('A second visit in May.') })
    await save('7', { baseVersion: 0, draftId: seven, document: withFinding(cite, '0.1', null) })
    const before = await workspace()

    const res = await restore('7', { baseVersion: 1, draftId: seven, from: `draft:${seven}` })

    expect(res.status).toBe(200)
    const after = res.body.workspace
    expect(sectionOf(after, '9')).toEqual(sectionOf(before, '9'))
    expect(after.parts).toEqual(before.parts)
    expect(await ReportSectionVersionModel.countDocuments({ sectionId: { $ne: '7' } })).toBe(2)
    // Section 7 reads as drafted again.
    expect(findingsOf(sectionOf(after, '7')).map((f) => f.review.state)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
  })

  it('restores the AI draft’s words over edits and rejections made in the review workspace', async () => {
    const { seven } = await drafted()
    await api
      .put(`${sectionPath('7')}/findings/0.1`)
      .send({ draftId: seven, text: 'The building is concrete.' })
    await api.post(`${sectionPath('7')}/findings/0.2/reject`).send({ draftId: seven })

    const res = await restore('7', { baseVersion: 0, draftId: seven, from: `draft:${seven}` })

    expect(res.status).toBe(200)
    expect(res.body.version).toMatchObject({ version: 1, restoredFrom: `draft:${seven}` })
    const [, frame, roof] = findingsOf(sectionOf(res.body.workspace, '7'))
    expect(frame).toMatchObject({ text: FRAME, review: { state: 'edited' } })
    expect(roof).toMatchObject({ text: ROOF, review: { state: 'pending' } })
  })

  it('carries a version written on an earlier draft onto the section’s new draft', async () => {
    const { seven, cite, assessment: a } = await drafted()
    const v1 = withFinding(
      cite,
      '0.1',
      paragraph([text('The building is a steel portal frame.'), citation(cite)], '0.1'),
    )
    v1.subsections[0].blocks.push(paragraph([text('Written by the engineer.')]))
    await save('7', { baseVersion: 0, draftId: seven, document: v1 })
    await tick()
    // Drafted again, with the same statements.
    const draft = await ReportSectionModel.findById(seven).lean()
    const { _id, createdAt, updatedAt, ...copy } = draft!
    void _id
    void createdAt
    void updatedAt
    const again = String((await ReportSectionModel.create({ ...copy, assessment: a._id }))._id)

    const listed = await history('7')
    expect(listed.entries.map((e) => e.id)).toEqual([
      `draft:${seven}`,
      'version:1',
      `draft:${again}`,
    ])
    expect(listed.entries[1].onSavedDraft).toBe(false)
    expect(listed.entries[2]).toMatchObject({ origin: 'redrafted', onSavedDraft: true })
    expect(listed.savedDraftId).toBe(again)

    const res = await restore('7', { baseVersion: 1, draftId: again, from: 'version:1' })

    expect(res.status).toBe(200)
    // Passages that are findings of the new draft stay findings; the reworded
    // one, no longer a finding's words, and the engineer's paragraph are their own text.
    expect(res.body.version.document.subsections[0].blocks).toEqual([
      paragraph([text(RISER), citation(cite)], '0.0'),
      paragraph([text('The building is a steel portal frame.'), citation(cite)]),
      paragraph([text(ROOF)], '0.2'),
      paragraph([text('Written by the engineer.')]),
    ])
    const section = sectionOf(res.body.workspace, '7')
    expect(section.document).toMatchObject({ version: 2, current: true })
    expect(findingsOf(section).map((f) => f.review.state)).toEqual([
      'pending',
      'rejected',
      'pending',
    ])
    expect(await ReviewAuditModel.findOne({ draft: again, finding: '0.1' }).lean()).toMatchObject({
      action: 'reject',
      inDocument: true,
      restoredFrom: 'version:1',
    })
  })

  it('restores what was written into a part with no draft', async () => {
    await drafted()
    await save('1', { baseVersion: 0, draftId: null, document: written('A second visit in May.') })
    await tick()
    await save('1', { baseVersion: 1, draftId: null, document: written('A second visit in June.') })

    const listed = await history('1')
    expect(listed.entries.map((e) => e.id)).toEqual(['version:1', 'version:2'])
    expect(listed.savedDraftId).toBeNull()

    const res = await restore('1', { baseVersion: 2, draftId: null, from: 'version:1' })

    expect(res.status).toBe(200)
    expect(res.body.workspace.parts['1']).toMatchObject({
      version: 3,
      current: true,
      restoredFrom: 'version:1',
      document: written('A second visit in May.'),
    })
    expect(await ReviewAuditModel.countDocuments()).toBe(0)
  })

  it('refuses a restore built on an older version (409), of an entry not in the history (404), or by anyone but the assigned engineer (403)', async () => {
    const { seven, cite } = await drafted()
    await save('7', { baseVersion: 0, draftId: seven, document: asDrafted(cite) })
    await save('7', { baseVersion: 1, draftId: seven, document: withFinding(cite, '0.2', null) })
    const body = { baseVersion: 2, draftId: seven, from: 'version:1' }

    const older = await restore('7', { ...body, baseVersion: 1 })
    expect(older.status).toBe(409)
    expect(older.body.error).toMatch(/version history/)
    expect((await restore('7', { ...body, draftId: String(new Types.ObjectId()) })).status).toBe(
      409,
    )
    expect((await restore('7', { ...body, from: 'version:9' })).status).toBe(404)
    expect((await restore('7', { ...body, from: `draft:${new Types.ObjectId()}` })).status).toBe(
      404,
    )
    expect((await restore('7', { ...body, from: 'v1' })).status).toBe(400)
    const other = signedInAs(app, user('Sam Lee', 'TEST-2'))
    expect((await other.post(`${sectionPath('7')}/versions/restore`).send(body)).status).toBe(403)
    expect(await ReportSectionVersionModel.countDocuments()).toBe(2)

    // Anyone who can view the assessment reads the history.
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect((await admin.get(`${sectionPath('7')}/versions`)).status).toBe(200)
    expect((await api.get(`${sectionPath('13')}/versions`)).status).toBe(404)
    expect((await api.get('/api/assessments/RPT-0000-0000/sections/7/versions')).status).toBe(404)
  })
})
