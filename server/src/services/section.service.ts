import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import type { CopeDimension } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { listObservations, type ObservationDto } from './observation.service'
import { listTemplateSections, requestSectionDraft, type TemplateSection } from './rag.service'

export class UnknownSectionError extends Error {
  constructor(sectionId: string) {
    super(`Section ${sectionId} is not one of the report's technical sections (7 to 12).`)
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
  // Observations added or changed since the newest draft, which a redraft takes in.
  changesSinceDraft: number
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

// A section's own evidence is what is filed under its COPE categories; it
// decides whether there is enough to draft. Observations under other
// categories go to the draft too, as backup, since one finding can concern
// several sections. Uncategorised ones (null) stay out (CP-02 AC4).
function categorised(observations: ObservationDto[]) {
  return observations.filter((o) => o.copeDimension)
}
function isFiledUnder(section: TemplateSection) {
  return (o: ObservationDto) => section.cope_dimensions.includes(o.copeDimension!)
}

// Usable evidence: a note, or a finished transcript. A failed or empty
// recording alone gives the draft nothing to cite.
function transcriptsOf(o: ObservationDto): string[] {
  return o.recordings.flatMap((r) =>
    r.transcription.status === 'transcribed' && r.transcription.transcript
      ? [r.transcription.transcript]
      : [],
  )
}
function isUsable(o: ObservationDto): boolean {
  return Boolean(o.note?.trim()) || transcriptsOf(o).length > 0
}

// An observation as the draft is given it, and as the draft saves it.
type Evidence = IReportSection['evidence'][number]
function toEvidence(o: ObservationDto): Evidence {
  return {
    id: o.id,
    COPE_dimension: o.copeDimension!,
    note: o.note,
    transcripts: transcriptsOf(o),
    severity: o.severity,
    location: o.location && [o.location.name, o.location.floor].filter(Boolean).join(', '),
    standard: o.standard,
  }
}
// Evidence the draft would get now that it did not get then: new observations,
// or ones whose note, transcripts or tags have changed.
function changesSince(evidence: Evidence[] | undefined, now: Evidence[]): number {
  const then = new Map((evidence ?? []).map((e) => [e.id, JSON.stringify(e)]))
  return now.filter((e) => then.get(e.id) !== JSON.stringify(e)).length
}

export type LoadedSection = {
  section: TemplateSection
  usableObservations: number
  latest: (IReportSection & { _id: unknown }) | null
  changesSinceDraft: number
}

export async function loadSections(reference: string): Promise<LoadedSection[]> {
  const assessment = await AssessmentModel.findOne({ reference }, '_id').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const [sections, observations, drafts] = await Promise.all([
    listTemplateSections(),
    listObservations(reference),
    ReportSectionModel.find({ assessment: assessment._id }).sort({ createdAt: -1 }).lean(),
  ])
  const usable = categorised(observations).filter(isUsable)
  const evidence = usable.map(toEvidence)
  return sections.map((section) => {
    const latest = drafts.find((d) => d.sectionId === section.id) ?? null
    return {
      section,
      usableObservations: usable.filter(isFiledUnder(section)).length,
      latest,
      changesSinceDraft: latest ? changesSince(latest.evidence, evidence) : 0,
    }
  })
}

// Sections 7-12 with how much usable evidence each has and its newest draft.
export async function listSections(reference: string): Promise<SectionSummaryDto[]> {
  return (await loadSections(reference)).map(
    ({ section, usableObservations, latest, changesSinceDraft }) => ({
      id: section.id,
      title: section.title,
      copeDimensions: section.cope_dimensions,
      minObservations: section.min_observations,
      usableObservations,
      latestDraft: latest ? toDraftDto(latest) : null,
      changesSinceDraft,
    }),
  )
}

// Drafts one of sections 7-12 from the assessment's observations (GN-01) and
// saves it with the evidence it was given and the configuration that wrote it.
// Only the assigned engineer can, while the assessment is not archived. It can
// be drafted again at any time, for example after more observations are added.
export async function draftSection(
  reference: string,
  sectionId: string,
  user: SessionUser,
): Promise<SectionDraftDto> {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)

  const section = (await listTemplateSections()).find((s) => s.id === sectionId)
  if (!section) throw new UnknownSectionError(sectionId)

  // Loaded by the assessment (AC2), oldest first so the draft reads them in
  // the order they were captured.
  const inputs = categorised((await listObservations(reference)).reverse())
  if (inputs.some((o) => o.recordings.some((r) => r.transcription.status === 'transcribing'))) {
    throw new TranscriptionInProgressError()
  }
  const usable = inputs.filter(isUsable)
  const own = usable.filter(isFiledUnder(section)).length
  if (own < section.min_observations) {
    throw new InsufficientEvidenceError(own, section.min_observations)
  }

  const site = assessment.site!
  const evidence = usable.map(toEvidence)
  const draft = await requestSectionDraft({
    section_id: sectionId,
    assessment: {
      reference,
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
      standards: assessment.standards,
    },
    observations: evidence,
  })

  const saved = await ReportSectionModel.create({
    assessment: assessment._id,
    sectionId,
    title: draft.title,
    subsections: draft.subsections,
    sources: draft.sources,
    questions: draft.questions,
    evidence,
    guardrail: draft.guardrail,
    provenance: { ...draft.provenance, generated_at: new Date(draft.provenance.generated_at) },
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
  return toDraftDto(saved.toObject())
}
