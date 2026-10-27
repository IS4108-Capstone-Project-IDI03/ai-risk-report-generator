// Pre-survey checklist (CP-30): the standards that apply to an assessment's
// site, and generating a checklist through S4 from the ones the engineer keeps.
// Called by assessment.routes; calls rag.service and the checklists collection.
import type { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import { ChecklistModel, type IChecklist } from '../models/checklist.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { listApplicableStandards } from './knowledge-document.service'
import { requestChecklistDraft } from './rag.service'
import { assessmentToDraft } from './section.service'

// A standard sent to generate with that isn't one of the site's (AC1), e.g.
// one withdrawn since the tab was opened.
export class UnknownStandardError extends Error {
  constructor() {
    super('One of the chosen standards no longer applies to this site. Reload and try again.')
    this.name = 'UnknownStandardError'
  }
}

export const generateChecklistSchema = z.object({
  // The standards kept ticked (AC2); none still gives template and hazard items (AC10).
  standardIds: z.array(z.string()).max(200),
})

export type StandardDto = {
  id: string
  title: string
  issuingBody: string | null
  standardNumber: string | null
  edition: string | null
  sourceType: string | null
  // When it was added to the knowledge base, so the tab can tick a standard
  // added since the last checklist (it ticks the ones that checklist used).
  uploadedAt: Date
}

type Checklist = IChecklist & { _id: Types.ObjectId }

function toDto({ _id, assessment: _a, createdBy: _c, metadata: _m, items, ...c }: Checklist) {
  return {
    id: String(_id),
    ...c,
    items: items.map(({ _id: itemId, ...item }) => ({ id: String(itemId), ...item })),
  }
}
export type ChecklistDto = ReturnType<typeof toDto>

async function applicable(site: Pick<ISite, 'facilityType' | 'jurisdiction'>) {
  return (await listApplicableStandards(site.facilityType, site.jurisdiction)).map(
    (d): StandardDto => ({
      id: d.id,
      title: d.title,
      issuingBody: d.issuingBody,
      standardNumber: d.standardNumber,
      edition: d.edition,
      sourceType: d.sourceType,
      uploadedAt: d.uploadedAt,
    }),
  )
}

async function latest(assessment: Types.ObjectId) {
  const found = await ChecklistModel.findOne({ assessment })
    .sort({ createdAt: -1, _id: -1 })
    .lean<Checklist>()
  return found ? toDto(found) : null
}

// The site's scope, the standards that apply to it now (AC1), and the latest
// checklist (AC9), or null before the first is generated.
export async function getChecklist(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  const site = assessment.site
  return {
    scope: { facilityType: site.facilityType, jurisdiction: site.jurisdiction },
    standards: await applicable(site),
    checklist: await latest(assessment._id),
  }
}

// Generates a checklist from the standards kept in scope and saves it as the
// assessment's latest; the earlier ones are kept. Only the assigned engineer
// can, while the assessment is not archived (AC11).
export async function generateChecklist(
  reference: string,
  user: SessionUser,
  input: z.infer<typeof generateChecklistSchema>,
) {
  const assessment = await assessmentToDraft(reference, user)
  const site = assessment.site
  if (!site) throw new AssessmentNotFoundError(reference)
  const standards = await applicable(site)
  const chosen = new Set(input.standardIds)
  if ([...chosen].some((id) => !standards.some((s) => s.id === id))) {
    throw new UnknownStandardError()
  }
  const inScope = standards.filter((s) => chosen.has(s.id))

  // Only the kind of site goes to S4, so no client detail needs masking.
  const draft = await requestChecklistDraft({
    facility_type: site.facilityType,
    jurisdiction: site.jurisdiction,
    standards: inScope.map((s) => ({
      id: s.id,
      source_type: s.sourceType,
      standard_number: s.standardNumber,
    })),
  })
  // Its paid calls, for the cost report (EV-03), all under the checklist, as
  // chat's are under chat.
  if (Array.isArray(draft.usage)) {
    await recordAiCalls(
      draft.usage.map((u: object) => ({ ...u, feature: 'checklist' })),
      { reportId: reference },
    )
  }

  const saved = await ChecklistModel.create({
    assessment: assessment._id,
    facilityType: site.facilityType,
    jurisdiction: site.jurisdiction,
    standards: inScope.map(({ issuingBody: _i, uploadedAt: _u, ...s }) => s),
    items: draft.items.map(({ citations, ...item }) => ({
      ...item,
      citations: citations.map((c) => ({ ref: c.ref, quote: c.quote, quoteFound: c.quote_found })),
    })),
    areas: draft.areas,
    hazards: draft.hazards.map(({ in_scope, ...h }) => ({ ...h, inScope: in_scope })),
    sources: draft.sources,
    provenance: { ...draft.provenance, generated_at: new Date(draft.provenance.generated_at) },
    createdBy: user.id,
    metadata: {
      source_type: 'checklist',
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
  return {
    scope: { facilityType: site.facilityType, jurisdiction: site.jurisdiction },
    standards,
    checklist: toDto(saved.toObject() as Checklist),
  }
}
