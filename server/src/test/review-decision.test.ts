import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import { AppendOnlyError, ReviewAuditModel } from '../models/review-audit.model'
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
const review = (path = '') => `/api/assessments/${REFERENCE}/sections${path}`

// S4 stands in as a stubbed fetch: the template's sections, and a fixed draft
// for a regenerated section, recording what it was sent.
const SECTIONS = [
  { id: '7', title: 'Construction', cope_dimensions: ['Construction'], min_observations: 1 },
  { id: '9', title: 'Fire Protection', cope_dimensions: ['Protection'], min_observations: 1 },
]
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const PROVENANCE = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  effort: 'high',
  prompt_version: 'gn01-v2.4',
  template_version: 'global-pre-v2.0-2026-02',
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/sections/draft')
      ? drafts(JSON.parse(String(init!.body)))
      : json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

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
      COPE_dimension: [copeDimension],
      effective_date: new Date(),
    },
  })
}

type Evidence = IReportSection['evidence'][number]
// An observation as the draft saved it, the same as now, so the draft is not
// out of date.
const evidence = (id: unknown, COPE_dimension: CopeDimension, note: string): Evidence => ({
  id: String(id),
  COPE_dimension: [COPE_dimension],
  note,
  transcripts: [],
  severity: 'high',
  location: 'Bay 3, Ground',
  standard: null,
})

type Statement = IReportSection['subsections'][number]['statements'][number]
const statement = (text: string, citations: string[], supported = true): Statement => ({
  text,
  citations,
  supported,
})

// A saved GN-01 draft of a section.
async function draft(
  assessmentId: Types.ObjectId,
  sectionId: string,
  statements: Statement[],
  given: Evidence[],
) {
  const section = SECTIONS.find((s) => s.id === sectionId)!
  return ReportSectionModel.create({
    assessment: assessmentId,
    sectionId,
    title: section.title,
    subsections: [
      { heading: `${section.title} Narrative`, kind: 'narrative', statements },
      { heading: `${section.title} Table`, kind: 'table', statements: [] },
    ],
    sources: {},
    questions: [],
    evidence: given,
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: { ...PROVENANCE, generated_at: new Date() },
    createdBy: engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: 'Warehouse',
      COPE_dimension: section.cope_dimensions[0] as CopeDimension,
      effective_date: new Date(),
    },
  })
}

// An assessment with section 7 drafted from one Construction observation:
// three findings, the third citing nothing, and section 9 drafted from one
// Protection observation.
async function drafted() {
  const { assessment: a, session } = await assessment()
  const ids = { assessment: a._id, session: session._id }
  const riser = await observation(ids, 'Construction', 'Riser on L3 not fire-stopped.')
  const valve = await observation(ids, 'Protection', 'Sprinkler control valve found shut.')
  const given = [
    evidence(riser._id, 'Construction', 'Riser on L3 not fire-stopped.'),
    evidence(valve._id, 'Protection', 'Sprinkler control valve found shut.'),
  ]
  const seven = await draft(
    a._id,
    '7',
    [
      statement('Riser penetrations at Level 3 were not fire-stopped.', [`O:${riser._id}`]),
      statement('The building is of steel-framed construction.', [`O:${riser._id}`]),
      statement('The roof is of fire-resistive construction.', [], false),
    ],
    given,
  )
  const nine = await draft(
    a._id,
    '9',
    [statement('A sprinkler control valve was found shut.', [`O:${valve._id}`])],
    given,
  )
  return { assessment: a, seven: String(seven._id), nine: String(nine._id), riser, valve }
}

type Section = {
  id: string
  review: { state: string; unsupportedStatements: number }
  findings: Record<string, number>
  completion: { written: number }
  draft: {
    id: string
    subsections: {
      statements: {
        text: string
        generatedText: string
        review: { state: string; at: string | null; by: { id: string; name: string } | null }
      }[]
    }[]
    provenance: { prompt_version: string; instruction?: string | null }
  }
  replacement: {
    draft: { id: string; subsections: { statements: { review: { state: string } }[] }[] }
    instruction: string | null
    requestedBy: { name: string } | null
  } | null
  history: {
    action: string
    finding: string | null
    before: string | null
    after: string | null
    citations: string[]
    bulk: boolean
    by: { id: string; name: string }
    at: string
    instruction: string | null
  }[]
}
const sectionOf = (body: { sections: Section[] }, id: string) =>
  body.sections.find((s) => s.id === id)!
const findingsOf = (section: Section) => section.draft.subsections[0].statements

describe('reviewing generated findings (RV-02)', () => {
  it('accepts a pending finding, recording who accepted it and when (AC1)', async () => {
    const { seven } = await drafted()

    const response = await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    const [accepted, pending] = findingsOf(section)
    expect(accepted.review).toMatchObject({
      state: 'accepted',
      by: { id: String(engineer._id), name: 'Alex Rowe' },
    })
    expect(Date.parse(accepted.review.at!)).not.toBeNaN()
    expect(pending.review).toEqual({ state: 'pending', at: null, by: null })
    expect(section.findings).toEqual({ total: 3, pending: 2, accepted: 1, edited: 0, rejected: 0 })

    // Accepting it again records nothing, so a double click is harmless.
    await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })
    expect(await ReviewAuditModel.countDocuments({ action: 'accept' })).toBe(1)

    // A finding citing nothing can be accepted, but it is still flagged: the
    // section needs review until it is rejected.
    const unsupported = await api.post(review('/7/findings/0.2/accept')).send({ draftId: seven })
    expect(sectionOf(unsupported.body, '7').review).toMatchObject({
      state: 'needs_review',
      unsupportedStatements: 1,
    })
  })

  it('replaces the text of an edited finding, keeping before and after with who edited it (AC2-AC4)', async () => {
    const { seven } = await drafted()
    const before = 'The building is of steel-framed construction.'
    const after = 'The warehouse is a single-storey steel portal frame.'

    const response = await api
      .put(review('/7/findings/0.1'))
      .send({ draftId: seven, text: `  ${after} ` })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    // The engineer's wording replaces the draft text (AC2).
    expect(findingsOf(section)[1]).toMatchObject({
      text: after,
      generatedText: before,
      review: { state: 'edited', by: { name: 'Alex Rowe' } },
    })
    // Its audit entry keeps the text before and after (AC3), and the signed-in
    // user and time that identify the edit (AC4).
    expect(section.history[0]).toMatchObject({
      action: 'edit',
      finding: '0.1',
      before,
      after,
      by: { id: String(engineer._id), name: 'Alex Rowe' },
    })
    expect(Date.parse(section.history[0].at)).not.toBeNaN()
    // The draft itself is never changed: the log holds the decision.
    const stored = await ReportSectionModel.findById(seven).lean()
    expect(stored?.subsections[0].statements[1].text).toBe(before)

    // A second edit is kept as its own before/after pair.
    const again = await api
      .put(review('/7/findings/0.1'))
      .send({ draftId: seven, text: 'The warehouse has a steel portal frame.' })
    expect(sectionOf(again.body, '7').history.slice(0, 2)).toMatchObject([
      { action: 'edit', before: after, after: 'The warehouse has a steel portal frame.' },
      { action: 'edit', before, after },
    ])

    // An edited finding can still be accepted, keeping the engineer's wording.
    const accepted = await api.post(review('/7/findings/0.1/accept')).send({ draftId: seven })
    expect(findingsOf(sectionOf(accepted.body, '7'))[1]).toMatchObject({
      text: 'The warehouse has a steel portal frame.',
      generatedText: before,
      review: { state: 'accepted' },
    })
    expect(sectionOf(accepted.body, '7').history[0]).toMatchObject({
      action: 'accept',
      before: 'The warehouse has a steel portal frame.',
    })
  })

  it('refuses an empty edit, and saving the same text records nothing', async () => {
    const { seven } = await drafted()
    const blank = await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: '   ' })
    expect(blank.status).toBe(400)
    expect(blank.body.fields.text).toBe('Write the finding, or reject it instead.')

    await api
      .put(review('/7/findings/0.1'))
      .send({ draftId: seven, text: 'The building is of steel-framed construction.' })
    expect(await ReviewAuditModel.countDocuments()).toBe(0)
  })

  it('removes a rejected finding from the draft and keeps its content in the immutable log (AC5, AC6)', async () => {
    const { seven } = await drafted()

    const response = await api.post(review('/7/findings/0.2/reject')).send({ draftId: seven })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    expect(findingsOf(section)[2].review.state).toBe('rejected')
    expect(section.findings).toMatchObject({ rejected: 1, pending: 2 })
    // The unsupported finding no longer flags the section once it is out.
    expect(section.review.unsupportedStatements).toBe(0)
    expect(section.review.state).toBe('in_review')
    // Its content stays in the log with the rejection record (AC6).
    expect(section.history[0]).toMatchObject({
      action: 'reject',
      finding: '0.2',
      before: 'The roof is of fire-resistive construction.',
      citations: [],
      by: { name: 'Alex Rowe' },
    })

    // The log refuses every change and deletion.
    const entry = await ReviewAuditModel.findOne({ action: 'reject' })
    await expect(ReviewAuditModel.updateOne({}, { before: 'Rewritten.' })).rejects.toThrow(
      AppendOnlyError,
    )
    await expect(
      ReviewAuditModel.findOneAndUpdate({}, { action: 'accept' }).exec(),
    ).rejects.toThrow(AppendOnlyError)
    await expect(ReviewAuditModel.deleteMany({})).rejects.toThrow(AppendOnlyError)
    await expect(entry!.deleteOne()).rejects.toThrow(AppendOnlyError)
    entry!.before = 'Rewritten.'
    await expect(entry!.save()).rejects.toThrow(AppendOnlyError)
    expect(await ReviewAuditModel.findById(entry!._id).lean()).toMatchObject({
      before: 'The roof is of fire-resistive construction.',
    })

    // A rejected finding cannot be accepted or edited until it is restored.
    const accept = await api.post(review('/7/findings/0.2/accept')).send({ draftId: seven })
    expect(accept.status).toBe(409)
    const edit = await api.put(review('/7/findings/0.2')).send({ draftId: seven, text: 'New.' })
    expect(edit.status).toBe(409)

    // Restoring returns it to where it stood before, with a record of that too.
    const restored = await api.post(review('/7/findings/0.2/restore')).send({ draftId: seven })
    const back = sectionOf(restored.body, '7')
    expect(findingsOf(back)[2].review.state).toBe('pending')
    expect(back.history.map((e) => e.action)).toEqual(['restore', 'reject'])
  })

  it('restores an edited finding with its edit', async () => {
    const { seven } = await drafted()
    await api.put(review('/7/findings/0.0')).send({ draftId: seven, text: 'Edited text.' })
    await api.post(review('/7/findings/0.0/reject')).send({ draftId: seven })
    const restored = await api.post(review('/7/findings/0.0/restore')).send({ draftId: seven })
    expect(findingsOf(sectionOf(restored.body, '7'))[0]).toMatchObject({
      text: 'Edited text.',
      review: { state: 'edited' },
    })
  })

  it('bulk accepts every pending finding of the section and leaves rejected and edited ones (AC7, AC8)', async () => {
    const { seven } = await drafted()
    await api.post(review('/7/findings/0.2/reject')).send({ draftId: seven })
    await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: 'Edited text.' })

    const response = await api.post(review('/7/bulk-accept')).send({ draftId: seven })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    expect(findingsOf(section).map((f) => f.review.state)).toEqual([
      'accepted',
      'edited',
      'rejected',
    ])
    expect(section.findings).toEqual({ total: 3, pending: 0, accepted: 1, edited: 1, rejected: 1 })
    expect(section.review.state).toBe('reviewed')
    expect(section.history[0]).toMatchObject({ action: 'accept', finding: '0.0', bulk: true })
    // Only that section: section 9's finding is still pending.
    expect(findingsOf(sectionOf(response.body, '9'))[0].review.state).toBe('pending')

    // With nothing pending, Bulk accept records nothing more.
    const count = await ReviewAuditModel.countDocuments()
    await api.post(review('/7/bulk-accept')).send({ draftId: seven })
    expect(await ReviewAuditModel.countDocuments()).toBe(count)
  })

  it('counts the review summary from the saved decisions, and keeps them when reopened (AC9)', async () => {
    const { seven, nine } = await drafted()
    await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })
    await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: 'Edited text.' })
    await api.post(review('/7/findings/0.2/reject')).send({ draftId: seven })
    await api.post(review('/9/findings/0.0/accept')).send({ draftId: nine })

    const reopened = await api.get(`/api/assessments/${REFERENCE}/review`)

    expect(reopened.body.summary).toEqual({
      total: 4,
      pending: 0,
      accepted: 2,
      edited: 1,
      rejected: 1,
    })
    expect(sectionOf(reopened.body, '7').findings).toEqual({
      total: 3,
      pending: 0,
      accepted: 1,
      edited: 1,
      rejected: 1,
    })
    expect(findingsOf(sectionOf(reopened.body, '7'))[1].text).toBe('Edited text.')
    // The same totals as the decisions in the log.
    const latest = await ReviewAuditModel.aggregate([
      { $sort: { sequence: -1 } },
      { $group: { _id: { draft: '$draft', finding: '$finding' }, action: { $first: '$action' } } },
    ])
    expect(latest.map((d) => d.action).sort()).toEqual(['accept', 'accept', 'edit', 'reject'])
  })

  it('applies a decision only to the saved draft it was made on, by its assigned engineer', async () => {
    const { seven, nine } = await drafted()

    // Another section's draft, as when the workspace is out of date.
    const stale = await api.post(review('/7/findings/0.0/accept')).send({ draftId: nine })
    expect(stale.status).toBe(409)
    expect((await api.post(review('/7/findings/0.0/accept')).send({})).status).toBe(400)
    expect((await api.post(review('/7/findings/4.0/accept')).send({ draftId: seven })).status).toBe(
      404,
    )
    expect((await api.post(review('/8/findings/0.0/accept')).send({ draftId: seven })).status).toBe(
      404,
    )

    // A knowledge admin reads the workspace but decides nothing; neither does an
    // engineer it is not assigned to.
    const admin = signedInAsRole(app, 'knowledge_admin')
    expect(
      (await admin.post(review('/7/findings/0.0/accept')).send({ draftId: seven })).status,
    ).toBe(403)
    const other = signedInAs(app, user('Sam Lee', 'TEST-2'))
    const refused = await other.post(review('/7/bulk-accept')).send({ draftId: seven })
    expect(refused.status).toBe(403)

    await AssessmentModel.updateOne({ reference: REFERENCE }, { archivedAt: new Date() })
    expect((await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })).status).toBe(
      409,
    )
    expect(await ReviewAuditModel.countDocuments()).toBe(0)
  })

  it('saves only one of two decisions made on a finding at the same moment', async () => {
    const { assessment: a, seven } = await drafted()
    const decision = {
      assessment: a._id,
      sectionId: '7',
      draft: new Types.ObjectId(seven),
      finding: '0.0',
      sequence: 0,
      action: 'accept' as const,
      by: { id: String(engineer._id), name: 'Alex Rowe' },
      at: new Date(),
      metadata: {
        source_type: 'review_decision' as const,
        jurisdiction: 'SG',
        facility_type: 'Warehouse',
        COPE_dimension: 'Construction' as const,
        effective_date: new Date(),
      },
    }
    await ReviewAuditModel.create(decision)
    await expect(ReviewAuditModel.create({ ...decision, action: 'reject' })).rejects.toThrow(
      /duplicate key/,
    )
  })
})

describe('regenerating a section (RV-02 AC10-AC12)', () => {
  const REPLACEMENT = (observationId: string) => ({
    section_id: '7',
    title: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        kind: 'narrative',
        statements: [
          {
            text: 'Level 3 riser penetrations lack fire stopping.',
            citations: [`O:${observationId}`],
            supported: true,
          },
        ],
      },
      { heading: 'Construction Table', kind: 'table', statements: [] },
    ],
    sources: {},
    questions: [],
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: {
      ...PROVENANCE,
      prompt_version: 'gn01-v2.4+rv02-v1',
      generated_at: '2026-10-11T06:00:00+00:00',
      instruction: 'Name the riser.',
    },
  })

  it('gives only the selected section a replacement draft, leaving its saved draft and decisions (AC10)', async () => {
    const { seven, nine, riser } = await drafted()
    drafts.mockImplementation(() => json(REPLACEMENT(String(riser._id))))
    await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: 'Edited text.' })
    await api.post(review('/7/findings/0.2/reject')).send({ draftId: seven })

    const response = await api
      .post(review('/7/regenerate'))
      .send({ instruction: '  Name the riser. ' })

    expect(response.status).toBe(201)
    // S4 is given the saved draft's findings with each decision, and the instruction.
    expect(drafts).toHaveBeenCalledOnce()
    expect(drafts.mock.calls[0][0]).toMatchObject({
      section_id: '7',
      redraft: {
        instruction: 'Name the riser.',
        current: [
          {
            heading: 'Construction Narrative',
            text: 'Riser penetrations at Level 3 were not fire-stopped.',
            decision: 'pending',
          },
          { heading: 'Construction Narrative', text: 'Edited text.', decision: 'edited' },
          {
            heading: 'Construction Narrative',
            text: 'The roof is of fire-resistive construction.',
            decision: 'rejected',
          },
        ],
      },
    })
    const seventh = sectionOf(response.body, '7')
    // The saved draft is still the section's content, with its decisions.
    expect(seventh.draft.id).toBe(seven)
    expect(findingsOf(seventh).map((f) => f.review.state)).toEqual([
      'pending',
      'edited',
      'rejected',
    ])
    expect(seventh.replacement).toMatchObject({
      instruction: 'Name the riser.',
      requestedBy: { name: 'Alex Rowe' },
    })
    // The edited finding is kept word for word, still edited; the rest wait for decisions.
    expect(seventh.replacement!.draft.subsections[0].statements.map((f) => f.review.state)).toEqual(
      ['edited', 'pending'],
    )
    expect(seventh.history[0]).toMatchObject({
      action: 'regenerate',
      instruction: 'Name the riser.',
    })
    // Only that section: section 9 is as it was.
    const ninth = sectionOf(response.body, '9')
    expect(ninth.draft.id).toBe(nine)
    expect(ninth.replacement).toBeNull()
    // The Generation tab still shows the saved draft.
    const listed = await api.get(`/api/assessments/${REFERENCE}/sections`)
    expect(listed.body[0].latestDraft.id).toBe(seven)

    // One replacement waits at a time.
    const again = await api.post(review('/7/regenerate')).send({})
    expect(again.status).toBe(409)
    expect(drafts).toHaveBeenCalledOnce()
  })

  it('makes an accepted replacement the saved section content, keeping accepted findings (AC11)', async () => {
    const { seven, riser } = await drafted()
    drafts.mockImplementation(() => json(REPLACEMENT(String(riser._id))))
    await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })
    const regenerated = await api.post(review('/7/regenerate')).send({})
    const replacementId = sectionOf(regenerated.body, '7').replacement!.draft.id

    const response = await api
      .post(review('/7/replacement/accept'))
      .send({ draftId: replacementId })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    expect(section.draft.id).toBe(replacementId)
    expect(section.replacement).toBeNull()
    // The accepted finding is kept word for word and still accepted; the new one waits.
    expect(findingsOf(section)).toMatchObject([
      {
        text: 'Riser penetrations at Level 3 were not fire-stopped.',
        review: { state: 'accepted', by: { name: 'Alex Rowe' } },
      },
      { text: 'Level 3 riser penetrations lack fire stopping.', review: { state: 'pending' } },
    ])
    expect(section.findings).toEqual({ total: 2, pending: 1, accepted: 1, edited: 0, rejected: 0 })
    expect(section.draft.provenance).toMatchObject({
      prompt_version: 'gn01-v2.4+rv02-v1',
      instruction: 'Name the riser.',
    })
    // The decisions on the earlier draft stay in the history.
    expect(section.history.map((e) => e.action)).toEqual([
      'accept_replacement',
      'regenerate',
      'accept',
    ])
    const listed = await api.get(`/api/assessments/${REFERENCE}/sections`)
    expect(listed.body[0].latestDraft.id).toBe(replacementId)
    // A decided replacement cannot be decided again.
    const twice = await api.post(review('/7/replacement/discard')).send({ draftId: replacementId })
    expect(twice.status).toBe(404)
  })

  it('keeps accepted and edited findings word for word when the section is drafted again from Generation', async () => {
    const { seven, nine, riser } = await drafted()
    const accepted = await api.post(review('/7/findings/0.0/accept')).send({ draftId: seven })
    const acceptedAt = sectionOf(accepted.body, '7').draft.subsections[0].statements[0].review.at
    await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: 'Edited text.' })
    await api.post(review('/7/findings/0.2/reject')).send({ draftId: seven })
    drafts.mockImplementation(() => json(REPLACEMENT(String(riser._id))))

    const response = await api.post(`/api/assessments/${REFERENCE}/sections/7/draft`)

    expect(response.status).toBe(201)
    // S4 is told the decisions, so it does not say the kept or rejected findings again.
    expect(drafts.mock.calls[0][0]).toMatchObject({
      redraft: {
        instruction: null,
        current: [
          { decision: 'accepted' },
          { text: 'Edited text.', decision: 'edited' },
          { decision: 'rejected' },
        ],
      },
    })
    const workspace = await api.get(`/api/assessments/${REFERENCE}/review`)
    const section = sectionOf(workspace.body, '7')
    // The new draft is the content at once: kept findings first, decided as before.
    expect(section.draft.id).toBe(response.body.id)
    expect(findingsOf(section)).toMatchObject([
      {
        text: 'Riser penetrations at Level 3 were not fire-stopped.',
        review: { state: 'accepted', at: acceptedAt },
      },
      {
        text: 'Edited text.',
        generatedText: 'The building is of steel-framed construction.',
        review: { state: 'edited' },
      },
      { text: 'Level 3 riser penetrations lack fire stopping.', review: { state: 'pending' } },
    ])
    // The copies are not listed again in the history.
    expect(section.history.map((e) => e.action)).toEqual(['reject', 'edit', 'accept'])
    // A section with nothing decided is drafted afresh.
    await api.post(`/api/assessments/${REFERENCE}/sections/9/draft`)
    expect(drafts.mock.calls[1][0]).not.toHaveProperty('redraft')
    expect(
      sectionOf((await api.get(`/api/assessments/${REFERENCE}/review`)).body, '9').draft.id,
    ).not.toBe(nine)
  })

  it('leaves the saved section content unchanged when the replacement is discarded (AC12)', async () => {
    const { seven, riser } = await drafted()
    drafts.mockImplementation(() => json(REPLACEMENT(String(riser._id))))
    await api.put(review('/7/findings/0.1')).send({ draftId: seven, text: 'Edited text.' })
    const before = sectionOf((await api.get(`/api/assessments/${REFERENCE}/review`)).body, '7')
    const regenerated = await api.post(review('/7/regenerate')).send({})
    const replacementId = sectionOf(regenerated.body, '7').replacement!.draft.id

    const response = await api
      .post(review('/7/replacement/discard'))
      .send({ draftId: replacementId })

    expect(response.status).toBe(200)
    const section = sectionOf(response.body, '7')
    expect(section.draft).toEqual(before.draft)
    expect(section.findings).toEqual(before.findings)
    expect(section.replacement).toBeNull()
    expect(section.history[0]).toMatchObject({ action: 'discard_replacement' })
    // The section can be regenerated again.
    expect((await api.post(review('/7/regenerate')).send({})).status).toBe(201)
  })

  it('regenerates only a drafted section, and saves nothing when drafting fails', async () => {
    const { seven } = await drafted()
    const long = await api.post(review('/7/regenerate')).send({ instruction: 'x'.repeat(1001) })
    expect(long.status).toBe(400)
    expect(long.body.fields.instruction).toBe('The instruction must be 1,000 characters or fewer.')

    drafts.mockImplementation(() =>
      json({ detail: 'The model declined to draft this section.' }, 502),
    )
    const failed = await api.post(review('/7/regenerate')).send({})
    expect(failed.status).toBe(503)
    expect(failed.body.error).toBe('The model declined to draft this section.')
    expect(await ReportSectionModel.countDocuments({ replacementFor: { $exists: true } })).toBe(0)
    expect(await ReviewAuditModel.countDocuments()).toBe(0)

    await ReportSectionModel.deleteOne({ _id: seven })
    const undrafted = await api.post(review('/7/regenerate')).send({})
    expect(undrafted.status).toBe(409)
    expect(undrafted.body.error).toMatch(/no draft to review yet/)
  })
})
