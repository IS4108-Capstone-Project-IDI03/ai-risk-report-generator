import type { Types } from 'mongoose'
import type { SessionUser } from './auth.service'
import { AssessmentModel, type IAssessment } from '../models/assessment.model'
import { copeDimensionsOf, type CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { locationText } from './location.service'
import { listObservations, type ObservationDto } from './observation.service'
import { recordAiCalls } from './ai-usage.service'
import { listTemplateSections, requestSectionDraft, type TemplateSection } from './rag.service'
import { lossEstimateFacts } from './loss-estimate.service'
import { riskQualityFacts } from './risk-quality.service'

export class UnknownSectionError extends Error {
  constructor(sectionId: string) {
    super(`Section ${sectionId} is not one of the report's drafted sections (4 to 12).`)
    this.name = 'UnknownSectionError'
  }
}
export class TranscriptionInProgressError extends Error {
  constructor() {
    super('A recording is still being transcribed. Try again shortly.')
    this.name = 'TranscriptionInProgressError'
  }
}
export class InsufficientEvidenceError extends Error {
  constructor(
    readonly found: number,
    readonly needed: number,
  ) {
    super(
      `Not enough evidence to draft this section: ${found} of ${needed} usable observation${needed === 1 ? '' : 's'} needed.`,
    )
    this.name = 'InsufficientEvidenceError'
  }
}

// Sections 4 and 5 (GN-03) before the engineer's figures are complete.
export class MissingFiguresError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingFiguresError'
  }
}

// The engineer's figures a Section 4 or 5 draft is given (`facts`), or why it
// cannot be drafted yet (`missing`). Other sections have neither.
export function figureFacts(
  sectionId: string,
  assessment: Pick<IAssessment, 'riskQuality' | 'lossEstimates'>,
): { facts?: string; missing?: string } {
  if (sectionId === '4') return riskQualityFacts(assessment.riskQuality)
  if (sectionId === '5') return lossEstimateFacts(assessment.lossEstimates)
  return {}
}

export type SectionDraftDto = {
  id: string
  sectionId: string
  title: string
  subsections: IReportSection['subsections']
  sources: IReportSection['sources']
  questions: IReportSection['questions']
  guardrail: IReportSection['guardrail']
  provenance: IReportSection['provenance']
  createdAt: Date
}

export type SectionSummaryDto = {
  id: string
  title: string
  copeDimensions: string[]
  minObservations: number
  usableObservations: number
  latestDraft: SectionDraftDto | null
  // Observations added, changed or removed since the newest draft, which a
  // redraft takes in: the total, and each kind on its own (CP-08).
  changesSinceDraft: number
  changeCounts: ChangeCounts
  // Sections 4 and 5 (GN-03): why the section cannot be drafted yet, else null.
  inputsMissing: string | null
}

export function toDraftDto(s: IReportSection & { _id: unknown }): SectionDraftDto {
  return {
    id: String(s._id),
    sectionId: s.sectionId,
    title: s.title,
    subsections: s.subsections,
    // Mongoose leaves out an empty object, as when no standard was cited.
    sources: s.sources ?? {},
    questions: s.questions ?? [],
    guardrail: s.guardrail,
    provenance: s.provenance,
    createdAt: s.createdAt,
  }
}

// A section's own evidence is what is filed under any of its COPE categories;
// it decides whether there is enough to draft. An observation filed under
// several categories is its own evidence in each of their sections, and counts
// towards each one's minimum. Observations under other categories go to the
// draft too, as backup, since one finding can concern several sections.
// Uncategorised ones (null) stay out (CP-02 AC4).
function categorised(observations: ObservationDto[]) {
  return observations.filter((o) => o.copeDimensions)
}
export function filedUnder(section: TemplateSection, categories: readonly string[]): boolean {
  return categories.some((c) => section.cope_dimensions.includes(c))
}
function isFiledUnder(section: TemplateSection) {
  return (o: ObservationDto) => filedUnder(section, o.copeDimensions!)
}

// Usable evidence: a note, or a finished transcript, as the engineer corrected
// it if they did (CP-08 AC10). A failed or empty recording alone gives the
// draft nothing to cite.
function transcriptsOf(o: ObservationDto): string[] {
  return o.recordings.flatMap((r) => {
    const text = r.transcription.correction?.text ?? r.transcription.transcript
    return r.transcription.status === 'transcribed' && text ? [text] : []
  })
}
function isUsable(o: ObservationDto): boolean {
  return Boolean(o.note?.trim()) || transcriptsOf(o).length > 0
}

// An observation as the draft is given it, and as the draft saves it.
export type Evidence = IReportSection['evidence'][number]
function toEvidence(o: ObservationDto): Evidence {
  return {
    id: o.id,
    COPE_dimension: o.copeDimensions!,
    note: o.note,
    transcripts: transcriptsOf(o),
    severity: o.severity,
    location: o.location && locationText(o.location),
    standard: o.standard,
  }
}
// How the evidence differs from what the draft was given, by kind (CP-08):
// observations added since, ones whose note, transcripts or tags have changed,
// and ones the draft was given that are no longer evidence, e.g. deleted or
// uncategorised (CP-08 AC15).
// `figures` (GN-03): 1 when Section 4 or 5's figures changed since the draft;
// present only then.
export type ChangeCounts = { added: number; changed: number; removed: number; figures?: number }
const NO_CHANGES: ChangeCounts = { added: 0, changed: 0, removed: 0 }
// A draft's evidence as it is compared with now: drafts saved before an
// observation could have several categories hold one string, read here as a
// list of one, so an unchanged observation doesn't count as changed.
export function savedEvidence(evidence: Evidence[] | undefined): Evidence[] {
  return (evidence ?? []).map((e) => ({
    ...e,
    COPE_dimension: copeDimensionsOf(e.COPE_dimension) ?? [],
  }))
}
function changesSince(evidence: Evidence[] | undefined, now: Evidence[]): ChangeCounts {
  const then = new Map(savedEvidence(evidence).map((e) => [e.id, JSON.stringify(e)]))
  const current = new Set(now.map((e) => e.id))
  return {
    added: now.filter((e) => !then.has(e.id)).length,
    changed: now.filter((e) => then.has(e.id) && then.get(e.id) !== JSON.stringify(e)).length,
    removed: [...then.keys()].filter((id) => !current.has(id)).length,
  }
}

// A saved draft as read from report_sections.
export type Draft = IReportSection & { _id: Types.ObjectId }

// A section's drafts as review sees them (RV-02): its saved content, and a
// replacement draft waiting for the engineer to accept or discard it.
export type SectionDrafts = { saved: Draft | null; replacement: Draft | null }
const NO_DRAFTS: SectionDrafts = { saved: null, replacement: null }

// How each replacement draft was decided, from the review audit log: accepted
// or discarded, and when. One with no entry here is still waiting.
async function replacementOutcomes(ids: Types.ObjectId[]) {
  const decided = ids.length
    ? await ReviewAuditModel.find(
        {
          draft: { $in: ids },
          finding: null,
          action: { $in: ['accept_replacement', 'discard_replacement'] },
        },
        'draft action at',
      ).lean()
    : []
  return new Map(
    decided.map((d) => [
      String(d.draft),
      { accepted: d.action === 'accept_replacement', at: d.at },
    ]),
  )
}

// Each section's saved content and waiting replacement, by section ID. A GN-01
// draft is the saved content from when it was made; a replacement (RV-02)
// only once accepted, and from when it was accepted, so accepting one makes
// it current even over a draft made while it waited. Of several waiting
// replacements, which the gateway does not make, the newest is shown.
export async function sectionDrafts(
  assessment: Types.ObjectId,
): Promise<Map<string, SectionDrafts>> {
  const drafts = await ReportSectionModel.find({ assessment })
    .sort({ createdAt: -1 })
    .lean<Draft[]>()
  const outcomes = await replacementOutcomes(
    drafts.filter((d) => d.replacementFor).map((d) => d._id),
  )
  // When a draft became the saved content; undefined if it never has.
  const savedSince = (d: Draft) => {
    if (!d.replacementFor) return d.createdAt
    const outcome = outcomes.get(String(d._id))
    return outcome?.accepted ? outcome.at : undefined
  }
  const bySection = new Map<string, SectionDrafts>()
  for (const draft of drafts) {
    const found = bySection.get(draft.sectionId) ?? { ...NO_DRAFTS }
    const since = savedSince(draft)
    if (since && (!found.saved || since.getTime() > savedSince(found.saved)!.getTime()))
      found.saved = draft
    if (draft.replacementFor && !outcomes.has(String(draft._id)) && !found.replacement)
      found.replacement = draft
    bySection.set(draft.sectionId, found)
  }
  return bySection
}

export type LoadedSection = {
  section: TemplateSection
  usableObservations: number
  // The section's saved content: its current draft.
  latest: Draft | null
  // A regenerated draft waiting to be accepted or discarded (RV-02).
  replacement: Draft | null
  // The total of changeCounts, which decides whether the draft is out of date.
  changesSinceDraft: number
  changeCounts: ChangeCounts
  inputsMissing: string | null
}

export async function loadSections(reference: string): Promise<LoadedSection[]> {
  const assessment = await AssessmentModel.findOne(
    { reference },
    '_id riskQuality lossEstimates',
  ).lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const [sections, observations, drafts] = await Promise.all([
    listTemplateSections(),
    listObservations(reference),
    sectionDrafts(assessment._id),
  ])
  const usable = categorised(observations).filter(isUsable)
  const evidence = usable.map(toEvidence)
  return sections.map((section) => {
    const { saved: latest, replacement } = drafts.get(section.id) ?? NO_DRAFTS
    const { facts, missing } = figureFacts(section.id, assessment)
    const counts = latest ? changesSince(latest.evidence, evidence) : NO_CHANGES
    // Figures changed since the draft was written, or since cleared, make it out of
    // date too (GN-03). Sections 6-12 have neither facts nor missing figures.
    const figuresChanged = (facts !== undefined && latest?.facts !== facts) || missing !== undefined
    const changeCounts = latest && figuresChanged ? { ...counts, figures: 1 } : counts
    return {
      section,
      usableObservations: usable.filter(isFiledUnder(section)).length,
      latest,
      replacement,
      changesSinceDraft:
        changeCounts.added +
        changeCounts.changed +
        changeCounts.removed +
        (changeCounts.figures ?? 0),
      changeCounts,
      inputsMissing: missing ?? null,
    }
  })
}

export async function listSections(reference: string): Promise<SectionSummaryDto[]> {
  return (await loadSections(reference)).map(
    ({ section, usableObservations, latest, changesSinceDraft, changeCounts, inputsMissing }) => ({
      id: section.id,
      title: section.title,
      copeDimensions: section.cope_dimensions,
      minObservations: section.min_observations,
      usableObservations,
      latestDraft: latest ? toDraftDto(latest) : null,
      changesSinceDraft,
      changeCounts,
      inputsMissing,
    }),
  )
}

// The assessment, with its site, for the assigned engineer to draft from or
// review: only they can, while it is not archived. Shared with OFI drafting
// (GN-05) and review decisions (RV-02).
export async function assessmentToDraft(reference: string, user: SessionUser) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  return assessment
}

// The usable, categorised observations a draft is given, loaded by the
// assessment (AC2), oldest first so the draft reads them in the order they
// were captured. Throws while a transcription is unfinished, since a draft
// would miss it. Shared with OFI drafting (GN-05).
export async function draftingEvidence(reference: string): Promise<Evidence[]> {
  const inputs = categorised((await listObservations(reference)).reverse())
  if (inputs.some((o) => o.recordings.some((r) => r.transcription.status === 'transcribing'))) {
    throw new TranscriptionInProgressError()
  }
  return inputs.filter(isUsable).map(toEvidence)
}

export type DraftableAssessment = Awaited<ReturnType<typeof assessmentToDraft>>

// One of sections 7-12 as the template defines it.
export async function templateSection(sectionId: string): Promise<TemplateSection> {
  const section = (await listTemplateSections()).find((s) => s.id === sectionId)
  if (!section) throw new UnknownSectionError(sectionId)
  return section
}

// A finding the engineer accepted or edited, kept word for word in any new
// draft of its section: its drafted text (the edit is carried as a decision),
// citations and subsection.
export type KeptFinding = {
  heading: string
  kind: IReportSection['subsections'][number]['kind']
  text: string
  citations: string[]
  supported: boolean
}

// What a new draft of a reviewed section is given beyond a first draft: the
// saved draft's findings, each with the engineer's decision on it, and what
// they asked to change (RV-02). `keep` goes into the new draft as it is, with
// the saved draft's sources it cites. With `replacementFor` (Regenerate), the
// draft is a replacement for that draft; without it (Draft on Generation), it
// is the section's content at once.
export type Redraft = {
  replacementFor?: Types.ObjectId
  instruction: string | null
  current: { heading: string; text: string; decision: string }[]
  keep: KeptFinding[]
  keptSources: Record<string, unknown>
}

// The new draft's subsections with the kept findings first in their own
// subsection, so an accepted finding is never lost to a redraft. A kept
// finding whose subsection the new draft lacks gets that subsection back.
function withKept(
  subsections: IReportSection['subsections'],
  keep: readonly KeptFinding[],
): IReportSection['subsections'] {
  const statements = (heading: string) =>
    keep
      .filter((k) => k.heading === heading)
      .map(({ text, citations, supported }) => ({ text, citations, supported }))
  const merged = subsections.map((sub) => ({
    ...sub,
    statements: [...statements(sub.heading), ...sub.statements],
  }))
  for (const { heading, kind } of keep) {
    if (!merged.some((sub) => sub.heading === heading)) {
      merged.push({ heading, kind, statements: statements(heading) })
    }
  }
  return merged
}

// Drafts one of sections 7-12 from the assessment's observations through S4
// and saves it with the evidence it was given and the configuration that
// wrote it. Throws when the section's own evidence is short of its minimum.
export async function writeDraft(
  assessment: DraftableAssessment,
  section: TemplateSection,
  user: SessionUser,
  redraft?: Redraft,
): Promise<Draft> {
  const evidence = await draftingEvidence(assessment.reference)
  const own = evidence.filter((e) => filedUnder(section, e.COPE_dimension)).length
  if (own < section.min_observations) {
    throw new InsufficientEvidenceError(own, section.min_observations)
  }
  // Sections 4 and 5 are drafted around the engineer's figures (GN-03), so not before.
  const { facts, missing } = figureFacts(section.id, assessment)
  if (missing) throw new MissingFiguresError(missing)

  const site = assessment.site!
  const draft = await requestSectionDraft({
    section_id: section.id,
    assessment: {
      reference: assessment.reference,
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
    },
    observations: evidence,
    ...(redraft && { redraft: { instruction: redraft.instruction, current: redraft.current } }),
    ...(facts && { facts }),
  })

  // The calls are billed even if saving the draft below fails, so record first.
  await recordAiCalls(draft.usage, { reportId: assessment.reference, section: section.id })
  const saved = await ReportSectionModel.create({
    assessment: assessment._id,
    sectionId: section.id,
    title: draft.title,
    subsections: withKept(draft.subsections, redraft?.keep ?? []),
    sources: { ...redraft?.keptSources, ...draft.sources },
    questions: draft.questions,
    evidence,
    facts,
    guardrail: draft.guardrail,
    provenance: {
      ...draft.provenance,
      generated_at: new Date(draft.provenance.generated_at),
      instruction: draft.provenance.instruction ?? redraft?.instruction ?? null,
    },
    ...(redraft?.replacementFor && { replacementFor: redraft.replacementFor }),
    createdBy: user.id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
      COPE_dimension:
        section.cope_dimensions.length === 1
          ? (section.cope_dimensions[0] as CopeDimension)
          : 'all',
      effective_date: new Date(),
    },
  })
  // The first drafted section starts the report.
  await AssessmentModel.updateOne(
    { _id: assessment._id, reportStatus: { $exists: false } },
    { $set: { reportStatus: 'draft' } },
  )
  return saved.toObject() as Draft
}
