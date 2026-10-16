// The report's opening sections (GN-07): Section 1 Purpose and Scope, assembled
// from the assessment's details, and Section 2's Executive Summary, drafted by
// S4 from the report's other sections. Called by routes/assessment.routes.ts.
// Calls S4 through rag.service.ts.
import type { Types } from 'mongoose'
import type { SessionUser } from './auth.service'
import { createHash } from 'node:crypto'
import { AssessmentModel, type IAssessment } from '../models/assessment.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { requestSummaryDraft } from './rag.service'
import { entriesFor, foldFindings } from './review-decision.service'
import {
  assessmentToDraft,
  figureFacts,
  sectionDrafts,
  toDraftDto,
  type SectionDraftDto,
} from './section.service'

// Every section the Executive Summary summarises, in report order, with its
// title in Marsh's template (Global PRE Report Template v2.0, contents page).
// All must be complete before it can be drafted (Miya, 10 Oct).
export const SUMMARISED_SECTIONS = [
  { id: '3', title: 'Opportunities for Improvement' },
  { id: '4', title: 'Risk Quality Ratings and Comments' },
  { id: '5', title: 'Loss Estimates' },
  { id: '6', title: 'Management Programs' },
  { id: '7', title: 'Construction' },
  { id: '8', title: 'Occupancy, Hazards, and Utilities' },
  { id: '9', title: 'Fire Protection' },
  { id: '10', title: 'External Exposures' },
  { id: '11', title: 'Security' },
  { id: '12', title: 'Business Interruption' },
]
type SectionRef = { id: string; title: string }

export class IncompleteSectionsError extends Error {
  constructor(readonly missing: SectionRef[]) {
    super(`Complete these sections first: ${missing.map((s) => `${s.id} ${s.title}`).join(', ')}.`)
    this.name = 'IncompleteSectionsError'
  }
}

const listed = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')

// Section 1 (AC1): Marsh's own Purpose and Scope. The template leaves it blank, and
// every past report in the knowledge base (mixed-use developments and a mall, read
// 11 Oct; none yet for offices) uses this same wording whatever the facility type, so
// it is fixed here with the assessment's client, site and locations put in. A
// paragraph is a string; the list of visit activities is an array.
// Past reports end "No physical tests were witnessed": left out, since the app does
// not record whether any were (Miya, 11 Oct).
export type PurposeAndScope = (string | string[])[]

const ACTIVITIES = [
  'Physical tours of occupied spaces to observe storage practices, related property hazards ' +
    'and identify areas not in accordance with the above guidelines.',
  'A review of existing loss prevention programs, procedures, reports and documentation to ' +
    'verify status in accordance with corporate standards and practices.',
  'Interview relevant staff to gain a perspective on loss prevention programs and ' +
    'implementation to understand issues facing local management.',
  'An exit meeting with management to achieve agreement with our conclusions and to develop ' +
    'a recommended action plan.',
]

export function purposeAndScope(
  a: Pick<IAssessment, 'client' | 'locations'>,
  site: Pick<ISite, 'name'>,
): PurposeAndScope {
  // The buildings the engineer recorded observations in, then the places
  // elsewhere on site (CP-16); else the past reports' usual ones.
  const locations = a.locations ?? []
  // Each building once, as first spelt.
  const named = new Map<string, string>()
  for (const { building } of locations)
    if (building && !named.has(building.toLowerCase())) named.set(building.toLowerCase(), building)
  const buildings = [...named.values()].sort((x, y) =>
    x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }),
  )
  const places = [
    ...buildings,
    ...locations
      .filter((l) => !l.building)
      .map((l) => 'the ' + (l.floor ? `${l.name} (${l.floor})` : l.name)),
  ]
  return [
    `The purpose of this PRE report is to assist ${a.client} with the implementation of a ` +
      'Risk Management Strategy to prioritize risk improvements and mitigation strategies for ' +
      `their property, ${site.name}. It is made on request by Marsh Broking Office. The ` +
      'analysis carried out is based on data provided by a physical review of the location. ' +
      'The report will inform existing and/or prospective insurance markets of physical ' +
      'conditions at this location. This report is based upon conditions and practices ' +
      'observed and information made available to Marsh Risk Consulting at the time of our ' +
      'survey. The report should be used for risk management and insurance placement ' +
      'purposes only.',
    'The visit comprised an inspection of the main areas of the site, including ' +
      `${places.length ? listed(places) : 'the electrical rooms, fire pump room and common areas'}.`,
    'Our visits used National Fire Protection Association (NFPA), FM Global and local ' +
      'guidelines as technical references. Each site visit included the following activities:',
    ACTIVITIES,
    'This survey also included a review of administrative controls such as inspection, ' +
      'testing, and maintenance of fire protection systems and equipment; impairments to ' +
      'these systems; and fire emergency planning.',
  ]
}

// Each summarised section as it stands now: its text for S4, and a version that
// changes whenever its content does (AC4). Sections 4-12: the saved draft (RV-02:
// a replacement only once accepted) with the engineer's decisions applied, so an
// edit is summarised as edited and a rejected finding not at all; its version is
// the draft's id and how many decisions it has. Section 3: the accepted OFIs' ids.
// A null version means the section is not complete.
async function currentSections(
  assessment: Pick<IAssessment, 'riskQuality' | 'lossEstimates'> & { _id: Types.ObjectId },
) {
  const [drafts, accepted] = await Promise.all([
    sectionDrafts(assessment._id),
    ReportOfiModel.find({ assessment: assessment._id, state: 'accepted' })
      .sort({ acceptedAt: 1 })
      .lean(),
  ])
  const saved = SUMMARISED_SECTIONS.flatMap((s) => drafts.get(s.id)?.saved ?? [])
  const entries = await entriesFor(saved.map((d) => d._id))
  return SUMMARISED_SECTIONS.map((s) => {
    if (s.id === '3') {
      return {
        ...s,
        version: accepted.length
          ? accepted
              .map((o) => String(o._id))
              .sort()
              .join(',')
          : null,
        text: accepted.map((o) => `${o.priority} — ${o.title}: ${o.description}`).join('\n'),
      }
    }
    const draft = drafts.get(s.id)?.saved
    // Sections 4 and 5 (GN-03) also need their figures complete, and are read with
    // them, so changing a figure changes the version too.
    const { facts, missing } = figureFacts(s.id, assessment)
    if (!draft || missing) return { ...s, version: null, text: '' }
    const decisions = entries.filter((e) => String(e.draft) === String(draft._id)).length
    // Each heading that still has a finding, then its findings' text now. Tables
    // are filled from measured values (GN-03), never by a draft, so carry nothing.
    const findings = foldFindings(draft, entries).filter((f) => f.state !== 'rejected')
    const headings = [...new Set(findings.map((f) => f.heading))]
    return {
      ...s,
      version: `${draft._id}:${decisions}${facts ? `:${createHash('sha1').update(facts).digest('hex')}` : ''}`,
      text: [
        ...(facts ? [facts] : []),
        ...headings.flatMap((h) => [
          h,
          ...findings.filter((f) => f.heading === h).map((f) => f.text),
        ]),
      ].join('\n'),
    }
  })
}

const ref = ({ id, title }: SectionRef): SectionRef => ({ id, title })

export type SummaryDto = {
  purposeAndScope: PurposeAndScope
  executiveSummary: {
    draft: SectionDraftDto | null
    // Sections still to complete before it can be drafted (AC3).
    missing: SectionRef[]
    // Sections changed since it was drafted (AC4).
    staleSections: SectionRef[]
  }
}

export async function getSummary(reference: string): Promise<SummaryDto> {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite }>('site', 'name')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const [sections, latest] = await Promise.all([
    currentSections(assessment),
    ReportSectionModel.findOne({ assessment: assessment._id, sectionId: '2' })
      .sort({ createdAt: -1 })
      .lean(),
  ])
  const now = new Map(sections.map((s) => [s.id, s.version]))
  const changed = new Set(
    (latest?.summarised ?? [])
      .filter((e) => now.get(e.sectionId) !== e.version)
      .map((e) => e.sectionId),
  )
  return {
    purposeAndScope: purposeAndScope(assessment, assessment.site),
    executiveSummary: {
      draft: latest ? toDraftDto(latest) : null,
      missing: sections.filter((s) => !s.version).map(ref),
      staleSections: sections.filter((s) => changed.has(s.id)).map(ref),
    },
  }
}

// Drafts the Executive Summary (AC2) once every summarised section is complete
// (AC3), and saves it as Section 2 with the version of each section it read.
// Only the assigned engineer can, while the assessment is not archived.
export async function draftSummary(reference: string, user: SessionUser): Promise<SectionDraftDto> {
  // 1. Who may draft, and the site for the required metadata.
  const assessment = await assessmentToDraft(reference, user)
  const site = assessment.site!

  // 2. Every section must be complete; otherwise no paid call is made.
  const sections = await currentSections(assessment)
  const missing = sections.filter((s) => !s.version)
  if (missing.length) throw new IncompleteSectionsError(missing.map(ref))

  // 3. S4 writes the summary from the sections' text alone.
  const draft = await requestSummaryDraft({
    assessment: { reference, jurisdiction: site.jurisdiction, facility_type: site.facilityType },
    sections: sections.map(({ id, title, text }) => ({ id, title, text })),
  })
  // The call is billed even if saving below fails, so record first.
  await recordAiCalls(draft.usage, { reportId: reference })

  // 4. Saved like a section draft. The template's other two parts of Section 2
  // are left for the engineer: the evidence says nothing of earlier surveys.
  const saved = await ReportSectionModel.create({
    assessment: assessment._id,
    sectionId: '2',
    title: 'Executive Summary',
    subsections: [
      { heading: 'Executive Summary', kind: 'narrative', statements: draft.statements },
      { heading: 'Changes Since Previous Survey', kind: 'narrative', statements: [] },
      { heading: 'Planned Changes / Projects', kind: 'narrative', statements: [] },
    ],
    sources: {},
    questions: [],
    evidence: [],
    summarised: sections.map((s) => ({ sectionId: s.id, version: s.version! })),
    guardrail: draft.guardrail,
    provenance: { ...draft.provenance, generated_at: new Date(draft.provenance.generated_at) },
    createdBy: user.id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
  return toDraftDto(saved.toObject())
}
