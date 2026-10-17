// Section 3 Opportunities for Improvement (GN-05): drafting suggestions through
// S4, accepting them into the report, and listing both. Called by
// assessment.routes; calls rag.service and the report_ofis collection.
import { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import { ReportOfiModel, type IReportOfi } from '../models/report-ofi.model'
import { recordAiCalls } from './ai-usage.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { findKnowledgeDocuments } from './knowledge-document.service'
import { requestOfiDraft } from './rag.service'
import { assessmentToDraft, draftingEvidence } from './section.service'

export class OfiNotFoundError extends Error {
  constructor(id: string) {
    super(`No Opportunity for Improvement ${id} on this assessment.`)
    this.name = 'OfiNotFoundError'
  }
}

// Section 3's order: Management Programs, then Physical Protection, then Other,
// as in the template and rag-service generation/ofi.json `categories`.
const CATEGORY_ORDER = ['Management Programs', 'Physical Protection', 'Other']

type Ofi = IReportOfi & { _id: Types.ObjectId }
export type OfiDto = Omit<IReportOfi, 'assessment' | 'createdBy' | 'metadata' | 'acceptedBy'> & {
  id: string
  // The title of the past report the precedent OFI comes from, or null.
  precedentReport: string | null
  // Marsh's fixed fields, the same for a suggestion as once accepted.
  status: 'New'
  issueDate: Date | null
}
// An accepted OFI as it reads in the report: numbered in report order.
export type AcceptedOfiDto = OfiDto & { number: string }

// Leaves out what the screen has no use for: ids of other records, the required
// metadata, and Mongoose's version key.
function toDto({
  _id,
  __v: _v,
  assessment: _a,
  createdBy: _c,
  metadata: _m,
  acceptedBy: _b,
  ...o
}: Ofi & { __v?: number }) {
  const figures = (v?: { pd: number | null; bi: number | null }) => ({
    pd: v?.pd ?? null,
    bi: v?.bi ?? null,
    total: v?.pd == null || v?.bi == null ? null : Math.round((v.pd + v.bi) * 100) / 100,
  })
  return {
    id: String(_id),
    ...o,
    sources: o.sources ?? {},
    lossExpectancy: {
      current: figures(o.lossExpectancy?.current),
      after: figures(o.lossExpectancy?.after),
    },
  }
}

// Suggestions (never in the report, AC3) and accepted OFIs in report order,
// numbered `<site visit year>-NN`, all given status and issue date. The
// number is worked out here, not stored, so accepting another OFI renumbers
// cleanly.
async function listFor(assessment: { _id: Types.ObjectId; siteVisitDate?: Date }) {
  const ofis = await ReportOfiModel.find({ assessment: assessment._id })
    .sort({ createdAt: 1 })
    .lean<Ofi[]>()
  const year = (assessment.siteVisitDate ?? new Date()).getUTCFullYear()
  // The precedent's report by its knowledge-base title (AC2): the chunk carries only
  // the document's id. null when the knowledge base has no record of it.
  const precedentDoc = (o: Ofi) => {
    const passage = o.precedent ? (o.sources?.[o.precedent] as { doc_id?: unknown }) : undefined
    return typeof passage?.doc_id === 'string' ? passage.doc_id : null
  }
  const titles = new Map(
    (await findKnowledgeDocuments(ofis.flatMap((o) => precedentDoc(o) ?? []))).map((d) => [
      d.id,
      d.title,
    ]),
  )
  const dto = (o: Ofi): OfiDto => ({
    ...toDto(o),
    precedentReport: titles.get(precedentDoc(o) ?? '') ?? null,
    status: 'New',
    issueDate: assessment.siteVisitDate ?? null,
  })
  const accepted = ofis
    .filter((o) => o.state === 'accepted')
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.acceptedAt!.getTime() - b.acceptedAt!.getTime(),
    )
    .map((o, i): AcceptedOfiDto => ({
      ...dto(o),
      number: `${year}-${String(i + 1).padStart(2, '0')}`,
    }))
  return {
    suggestions: ofis.filter((o) => o.state === 'suggested').map(dto),
    accepted,
  }
}

export async function listOfis(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }).lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return listFor(assessment)
}

// Drafts OFI suggestions from the assessment's usable observations through S4
// and replaces the unaccepted ones; accepted OFIs stay, and S4 is told their
// titles so it doesn't propose them again.
export async function draftOfis(reference: string, user: SessionUser) {
  const assessment = await assessmentToDraft(reference, user)
  const evidence = await draftingEvidence(reference)
  const accepted = await ReportOfiModel.find({ assessment: assessment._id, state: 'accepted' })
    .select('title')
    .lean()
  const site = assessment.site!
  const draft = await requestOfiDraft({
    assessment: {
      reference,
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
    },
    observations: evidence,
    accepted: accepted.map((o) => o.title),
  })
  // Its paid calls, for the cost report (EV-03), as section drafting records them.
  // OFIs are Section 3 of the report.
  await recordAiCalls(draft.usage, { reportId: reference, section: '3' })

  const provenance = {
    ...draft.provenance,
    generated_at: new Date(draft.provenance.generated_at),
  }
  // Saved before the old suggestions go, so a failed save leaves them in place.
  const saved = await ReportOfiModel.insertMany(
    draft.ofis.map((o) => ({
      ...o,
      lossExpectancy: undefined,
      assessment: assessment._id,
      state: 'suggested',
      // Each OFI keeps only the passages it cites (AC2).
      sources: Object.fromEntries(
        Object.entries(draft.sources).filter(([ref]) =>
          [...o.standards, o.precedent].includes(ref),
        ),
      ),
      provenance,
      createdBy: user.id,
      metadata: {
        source_type: 'ofi',
        jurisdiction: site.jurisdiction,
        facility_type: site.facilityType,
        COPE_dimension: 'all',
        effective_date: new Date(),
      },
    })),
  )
  await ReportOfiModel.deleteMany({
    assessment: assessment._id,
    state: 'suggested',
    _id: { $nin: saved.map((o) => o._id) },
  })
  return listFor(assessment)
}

// Accepts a suggestion into the report (AC4). Accepting an accepted OFI changes
// nothing, so a double click is harmless.
export async function acceptOfi(reference: string, id: string, user: SessionUser) {
  const assessment = await assessmentToDraft(reference, user)
  if (!Types.ObjectId.isValid(id)) throw new OfiNotFoundError(id)
  const ofi = await ReportOfiModel.findOneAndUpdate(
    { _id: id, assessment: assessment._id, state: 'suggested' },
    { $set: { state: 'accepted', acceptedAt: new Date(), acceptedBy: user.id } },
  )
  if (!ofi && !(await ReportOfiModel.exists({ _id: id, assessment: assessment._id }))) {
    throw new OfiNotFoundError(id)
  }
  return listFor(assessment)
}

// Loss values on a suggestion would be lost when OFIs are redrafted, as that
// replaces every suggestion; so they are entered only once accepted.
export class OfiNotAcceptedError extends Error {
  constructor() {
    super('Accept this Opportunity for Improvement before entering its loss values.')
    this.name = 'OfiNotAcceptedError'
  }
}

const lossAmount = z.number().min(0).max(1e13).multipleOf(0.01).nullable()
const lossPair = z.object({ pd: lossAmount, bi: lossAmount }).strict()
export const ofiLossValuesSchema = z.object({ current: lossPair, after: lossPair }).strict()

export async function saveOfiLossValues(
  reference: string,
  id: string,
  input: z.infer<typeof ofiLossValuesSchema>,
  user: SessionUser,
) {
  const assessment = await assessmentToDraft(reference, user)
  if (!Types.ObjectId.isValid(id)) throw new OfiNotFoundError(id)
  const saved = await ReportOfiModel.findOneAndUpdate(
    { _id: id, assessment: assessment._id, state: 'accepted' },
    {
      $set: {
        lossExpectancy: input,
        lossValuesUpdatedAt: new Date(),
        lossValuesUpdatedBy: user.id,
      },
    },
  )
  if (!saved) {
    if (await ReportOfiModel.exists({ _id: id, assessment: assessment._id })) {
      throw new OfiNotAcceptedError()
    }
    throw new OfiNotFoundError(id)
  }
  return listFor(assessment)
}
