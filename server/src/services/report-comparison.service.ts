// Comparing an assessment with the previous report for the same site (RV-13):
// which earlier finalised reports of the site it can be compared with, running
// a comparison through S4 with client details masked first (privacy.service,
// fail closed), the engineer's decisions, and the comparison as the tab reads
// it, out of date once the evidence changed. It reads the previous report and
// the current assessment and writes only `report_comparisons`: never a
// section, version, review log entry, finding or the export. Called by
// routes/comparison.routes.ts; the rules are report-comparison-rules.ts.
import { createHash } from 'crypto'
import { Types } from 'mongoose'
import { z } from 'zod'
import { AssessmentModel } from '../models/assessment.model'
import type { CopeDimension, Severity } from '../models/observation.model'
import {
  COMPARISON_OUTCOMES,
  ReportComparisonModel,
  type ComparisonOutcome,
  type ICurrentSource,
  type IComparisonDecision,
  type IPreviousItem,
  type IReportComparison,
  type ItemOutcome,
} from '../models/report-comparison.model'
import type { ISite } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { recordAiCalls } from './ai-usage.service'
import { NotAssignedError, opensAssessment } from './assessment.service'
import type { SessionUser } from './auth.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { locationText } from './location.service'
import { listObservations, type ObservationDto } from './observation.service'
import { listOfis } from './ofi.service'
import { hasPermission } from './permissions.service'
import { NOT_PRACTICE } from './practice/filter'
import { privacyFor } from './privacy.service'
import {
  listTemplateSections,
  RagServiceError,
  requestReportComparison,
  type ComparedItem,
  type TemplateSection,
} from './rag.service'
import {
  carryDecisions,
  changesLine,
  changesSince,
  COMPARISON_RULES,
  countsLine,
  foldComparison,
  highest,
  settleItem,
  type ComparisonCounts,
  type ComparisonItemView,
  type SourceChange,
} from './report-comparison-rules'
import { entriesFor, foldFindings } from './review-decision.service'
import { citesOf, plainText, textBlocksOf } from './section-document'
import { sectionLabel } from './section-guidance.service'
import {
  handwritingOf,
  observationFacts,
  savedEvidence,
  sectionDrafts,
  transcriptsOf,
} from './section.service'
import { hyphenated } from './speech.service'
import { sectionNow } from './text-proposal.service'

// The sections whose text is compared; Section 3's OFIs are compared as recommendations.
// Section 2 summarises these, and Section 1 and Appendix A hold no findings.
const DRAFTED_SECTIONS = ['4', '5', '6', '7', '8', '9', '10', '11', '12']
// Words of one item or source sent to S4 and kept, at most: long transcripts are cut.
const MAX_TEXT = 6000
const OBSERVATIONS_SECTION = 'Observations'

export class ComparisonError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ComparisonError'
  }
}

// A run that S4 could not finish: its reason and time, kept as a failed run.
export class ComparisonRunError extends Error {
  constructor(
    message: string,
    readonly at: Date,
  ) {
    super(message)
    this.name = 'ComparisonRunError'
  }
}

type Assessment = {
  _id: Types.ObjectId
  reference: string
  engineer?: Types.ObjectId
  site: ISite & { _id: Types.ObjectId }
  siteVisitDate?: Date
  createdAt: Date
  archivedAt?: Date
}

const cut = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text)
const hash = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex')

// The assessment, when the user may open it (its assigned engineer or a knowledge admin).
async function openedAssessment(reference: string, user: SessionUser): Promise<Assessment> {
  const assessment = await AssessmentModel.findOne(
    { reference },
    'reference engineer site siteVisitDate createdAt archivedAt',
  )
    .populate<{ site: Assessment['site'] }>('site', 'jurisdiction facilityType')
    .lean<Assessment>()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  if (!opensAssessment(user, assessment.engineer))
    throw new ComparisonError(
      "Only the assessment's assigned engineer and knowledge admins can open its comparison.",
      403,
    )
  return assessment
}

// Running a comparison or deciding an item: the assigned engineer, while not archived.
function checkCanChange(assessment: Assessment, user: SessionUser) {
  if (String(assessment.engineer) !== user.id || !hasPermission(user.role, 'reports:generate'))
    throw new NotAssignedError('Only the assigned engineer can compare this assessment.')
  if (assessment.archivedAt) throw new AssessmentArchivedError(assessment.reference)
}

// ---- The previous reports ---------------------------------------------------

export type PreviousReportDto = {
  reference: string
  siteVisitDate: Date | null
  // The lead engineer: the report's assigned engineer, by their name now.
  engineer: string | null
}
type PreviousReport = PreviousReportDto & { id: Types.ObjectId; engineerId: string | null }

/**
 * Returns the site's earlier finalised reports, latest first: assessments of
 * the same site with `reportStatus: 'finalised'`, not archived and not practice
 * (F-12), whose site visit (else creation) came before this one's.
 */
async function earlierFinalised(assessment: Assessment): Promise<PreviousReport[]> {
  const when = (a: { siteVisitDate?: Date | null; createdAt: Date }) =>
    (a.siteVisitDate ?? a.createdAt).getTime()
  const found = await AssessmentModel.find(
    {
      site: assessment.site._id,
      _id: { $ne: assessment._id },
      reportStatus: 'finalised',
      archivedAt: null,
      // F-12: reads across records, so never a practice assessment.
      ...NOT_PRACTICE,
    },
    'reference siteVisitDate createdAt engineer',
  ).lean()
  const earlier = found.filter((a) => when(a) < when(assessment)).sort((a, b) => when(b) - when(a))
  const names = new Map(
    (
      await UserModel.find(
        { _id: { $in: earlier.flatMap((a) => a.engineer ?? []) } },
        'name',
      ).lean()
    ).map((u) => [String(u._id), u.name]),
  )
  return earlier.map((a) => ({
    id: a._id,
    reference: a.reference,
    siteVisitDate: a.siteVisitDate ?? null,
    engineer: a.engineer ? (names.get(String(a.engineer)) ?? null) : null,
    engineerId: a.engineer ? String(a.engineer) : null,
  }))
}

// ---- What is compared -----------------------------------------------------

type Evidence = {
  severity: Severity | null
  categories: CopeDimension[]
  location: string | null
}

// What an observation tells a comparison: its severity only once it is the
// engineer's (a suggestion still to check is not), its categories and place.
function evidenceOf(o: ObservationDto): Evidence {
  return {
    severity: o.toCheck ? null : o.severity,
    categories: o.copeDimensions ?? [],
    location: o.location ? locationText(o.location) : null,
  }
}

// Its words as evidence: the note's facts, transcripts and handwriting, else
// its photos' description. Empty when it has none yet.
function observationText(o: ObservationDto): string {
  const words = [observationFacts(o), ...transcriptsOf(o), ...handwritingOf(o)]
    .map((w) => w?.trim())
    .filter(Boolean)
  if (words.length) return words.join('\n')
  const described = o.interpretation?.photos?.description?.trim()
  return described ? `Photos: ${described}` : ''
}

const sectionCategory = (sectionId: string, templates: readonly TemplateSection[]) => {
  const cope = templates.find((t) => t.id === sectionId)?.cope_dimensions ?? []
  return cope.length === 1 ? (cope as CopeDimension[]) : []
}

/**
 * Returns the previous report's findings and recommendations, in report order:
 * each block of Sections 4 to 12's text as the report reads it (a drafted
 * finding or the engineer's own words), then each accepted OFI. Severity,
 * categories and location come from the observations a block cites, as its
 * draft was given them.
 */
async function previousItems(
  previous: PreviousReport,
  templates: readonly TemplateSection[],
): Promise<IPreviousItem[]> {
  const observations = new Map(
    (await listObservations(previous.reference, { includeDeleted: true })).map((o) => [o.id, o]),
  )
  const items: Omit<IPreviousItem, 'label'>[] = []
  const cited = (ids: string[], drafted: Map<string, Evidence>): Evidence => {
    const found = ids.flatMap((id) => {
      const e = drafted.get(id) ?? (observations.has(id) ? evidenceOf(observations.get(id)!) : null)
      return e ? [e] : []
    })
    return {
      severity: highest(found.map((e) => e.severity)),
      categories: [...new Set(found.flatMap((e) => e.categories))],
      location: found.find((e) => e.location)?.location ?? null,
    }
  }
  for (const sectionId of DRAFTED_SECTIONS) {
    const { draft, document } = await sectionNow(previous.id, sectionId)
    const drafted = new Map(
      savedEvidence(draft?.evidence).map((e) => [
        e.id,
        {
          severity: (e.severity as Severity) ?? null,
          categories: e.COPE_dimension as CopeDimension[],
          location: e.location ?? null,
        },
      ]),
    )
    textBlocksOf(document).forEach((block, n) => {
      const quote = plainText(block.content)
      if (block.shape === 'heading' || !quote) return
      const ids = citesOf(block.content).flatMap((c) => (c.startsWith('O:') ? [c.slice(2)] : []))
      const e = cited(ids, drafted)
      items.push({
        key: `P:${sectionId}:${block.finding ?? `b${n}`}`,
        kind: 'finding',
        sectionId,
        section: sectionLabel(sectionId, templates),
        heading: document.subsections[block.subsection]?.heading ?? null,
        quote,
        context: null,
        severity: e.severity,
        priority: null,
        categories: e.categories.length ? e.categories : sectionCategory(sectionId, templates),
        location: e.location,
      })
    })
  }
  const { accepted } = await listOfis(previous.reference)
  for (const ofi of accepted) {
    const e = cited(ofi.observations, new Map())
    items.push({
      key: `P:3:${ofi.id}`,
      kind: 'recommendation',
      sectionId: '3',
      section: sectionLabel('3', templates),
      heading: `${ofi.number} ${ofi.title}`,
      quote: ofi.description,
      context: ofi.observation || null,
      severity: null,
      priority: ofi.priority,
      categories: e.categories,
      location: e.location,
    })
  }
  return items.map((item, i) => ({ ...item, label: `P${i + 1}` }))
}

/**
 * Returns the current assessment's evidence: its observations with words to
 * compare, its draft findings (Sections 4 to 12, as reviewed: a rejected one
 * left out, an edited one as edited) and its accepted OFIs. Labels O1, F1, R1
 * as S4 is given them. `templates` names the sections; without it (reading
 * whether a comparison is out of date) they are named by number.
 */
async function currentSources(
  assessment: Assessment,
  templates: readonly TemplateSection[],
): Promise<ICurrentSource[]> {
  // Oldest first, so labels and New items keep the order they were recorded in.
  const observations = (await listObservations(assessment.reference)).sort(
    (a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime() || (a.id < b.id ? -1 : 1),
  )
  const byId = new Map(observations.map((o) => [o.id, o]))
  const label = (id: string) => sectionLabel(id, templates)
  // `tags`: what its tag hash is made from, without the section's own category,
  // which reading leaves unnamed (no S4 call), so a read never sees a change.
  type Source = Omit<ICurrentSource, 'label' | 'textHash' | 'tagHash'> & { tags: unknown }
  const sources: Source[] = []
  for (const o of observations) {
    const text = observationText(o)
    if (!text) continue
    const e = evidenceOf(o)
    sources.push({
      key: `O:${o.id}`,
      kind: 'observation',
      sectionId: null,
      section: OBSERVATIONS_SECTION,
      title: e.location,
      text: cut(text),
      ...e,
      priority: null,
      observations: [o.id],
      finding: null,
      tags: [e.categories, e.severity, e.location],
    })
  }
  const drafts = await sectionDrafts(assessment._id)
  const saved = DRAFTED_SECTIONS.flatMap((id) => drafts.get(id)?.saved ?? [])
  const entries = await entriesFor(saved.map((d) => d._id))
  for (const draft of saved) {
    for (const f of foldFindings(draft, entries)) {
      if (f.state === 'rejected' || !f.text.trim()) continue
      const ids = f.citations.flatMap((c) => (c.startsWith('O:') ? [c.slice(2)] : []))
      const cited = ids.flatMap((id) => (byId.has(id) ? [evidenceOf(byId.get(id)!)] : []))
      const cope = sectionCategory(draft.sectionId, templates)
      const categories = [...new Set(cited.flatMap((e) => e.categories))]
      const severity = highest(cited.map((e) => e.severity))
      const location = cited.find((e) => e.location)?.location ?? null
      sources.push({
        key: `F:${draft.sectionId}:${draft._id}:${f.key}`,
        kind: 'finding',
        sectionId: draft.sectionId,
        section: label(draft.sectionId),
        title: f.heading || null,
        text: cut(f.text.trim()),
        severity,
        priority: null,
        categories: [...new Set([...categories, ...cope])],
        location,
        observations: ids,
        finding: f.key,
        tags: [categories, severity, location],
      })
    }
  }
  const { accepted } = await listOfis(assessment.reference)
  for (const ofi of accepted) {
    const cited = ofi.observations.flatMap((id) =>
      byId.has(id) ? [evidenceOf(byId.get(id)!)] : [],
    )
    const categories = [...new Set(cited.flatMap((e) => e.categories))]
    const location = cited.find((e) => e.location)?.location ?? null
    sources.push({
      key: `R:${ofi.id}`,
      kind: 'recommendation',
      sectionId: '3',
      section: label('3'),
      title: ofi.title,
      text: cut(`${ofi.description}\nObserved: ${ofi.observation}`.trim()),
      severity: null,
      priority: ofi.priority,
      categories,
      location,
      observations: ofi.observations,
      finding: null,
      tags: [categories, location, ofi.priority],
    })
  }
  const counter = { observation: 0, finding: 0, recommendation: 0 }
  const prefix = { observation: 'O', finding: 'F', recommendation: 'R' }
  return sources.map(({ tags, ...s }) => ({
    ...s,
    label: `${prefix[s.kind]}${(counter[s.kind] += 1)}`,
    textHash: hash(s.text),
    tagHash: hash(tags),
  }))
}

// What S4 is given of a previous item: an OFI's words with what it observed then.
const previousWire = (i: IPreviousItem): ComparedItem => ({
  label: i.label,
  kind: i.kind,
  section: i.section,
  title: i.heading,
  text: cut(i.context ? `${i.quote}\nObserved: ${i.context}` : i.quote),
  severity: i.severity,
  priority: i.priority,
  categories: i.categories,
  location: i.location,
})

const currentWire = (s: ICurrentSource): ComparedItem => ({
  label: s.label,
  kind: s.kind,
  section: s.section,
  title: s.title,
  text: s.text,
  severity: s.severity,
  priority: s.priority,
  categories: s.categories,
  location: s.location,
})

// ---- Reading -----------------------------------------------------------------

type Stored = IReportComparison & { _id: Types.ObjectId }

// A current source as the tab shows it: what was compared, without its hashes and label.
type Unshown = 'label' | 'observations' | 'textHash' | 'tagHash'
export type ComparisonSourceDto = Omit<ICurrentSource, Unshown> & {
  // An observation's id, to open it; null for a draft finding or OFI.
  observationId: string | null
  // Whether it is still in the assessment as it was compared.
  current: boolean
}

export type ComparisonDto = {
  id: string
  previous: PreviousReportDto
  ranAt: Date
  ranBy: { id: string; name: string }
  items: ComparisonItemView[]
  counts: ComparisonCounts
  // The counts as one line, e.g. "3 fixed, 2 worse, 5 unchanged, 4 new, 1 not checked".
  summary: string
  sources: ComparisonSourceDto[]
  // What changed in the evidence since it ran; null while it is current.
  outOfDate: { summary: string; changes: SourceChange[] } | null
  privacy: { enabled: boolean; masked_count: number } | null
}

export type ComparisonPageDto = {
  reference: string
  previousReports: PreviousReportDto[]
  // The report compared against: the one asked for, else the latest. null when
  // the site has none.
  previous: PreviousReportDto | null
  // The assigned engineer, while not archived. Everyone else reads.
  canChange: boolean
  // Why it is read only, for the tab to say; null when canChange.
  readOnly: 'archived' | 'not_assigned' | null
  observations: number
  comparison: ComparisonDto | null
  // The latest run against this report, when it failed after the last finished one.
  failure: { error: string; at: Date } | null
  running: boolean
}

const publicReport = ({
  reference,
  siteVisitDate,
  engineer,
}: PreviousReport): PreviousReportDto => ({
  reference,
  siteVisitDate,
  engineer,
})

function toDto(c: Stored, now: ICurrentSource[] | null): ComparisonDto {
  const { items, counts } = foldComparison(c)
  const live = new Map((now ?? []).map((s) => [s.key, s]))
  const changes = now ? changesSince(c.sources, now) : []
  return {
    id: String(c._id),
    previous: {
      reference: c.previous.reference,
      siteVisitDate: c.previous.siteVisitDate,
      engineer: c.previous.engineer?.name ?? null,
    },
    ranAt: c.createdAt,
    ranBy: { id: c.createdBy.id, name: c.createdBy.name },
    items,
    counts,
    summary: countsLine(counts),
    sources: c.sources.map((s) => ({
      key: s.key,
      kind: s.kind,
      sectionId: s.sectionId,
      section: s.section,
      title: s.title,
      text: s.text,
      severity: s.severity,
      priority: s.priority,
      categories: s.categories,
      location: s.location,
      finding: s.finding,
      observationId: s.kind === 'observation' ? s.key.slice(2) : null,
      current:
        !now ||
        (live.get(s.key)?.textHash === s.textHash && live.get(s.key)?.tagHash === s.tagHash),
    })),
    outOfDate: changes.length ? { summary: changesLine(changes), changes } : null,
    privacy: c.provenance?.privacy ?? null,
  }
}

// Runs under way, by assessment: one at a time, so a second tap never pays twice.
const running = new Set<string>()

// Newest first: by when it was made, then by id, for two made in the same millisecond.
const NEWEST = { createdAt: -1, _id: -1 } as const
const isNewer = (a: Stored, b: Stored) =>
  a.createdAt.getTime() > b.createdAt.getTime() ||
  (a.createdAt.getTime() === b.createdAt.getTime() && String(a._id) > String(b._id))

// The latest finished run against one previous report.
function latestDone(assessment: Types.ObjectId, reference: string) {
  return ReportComparisonModel.findOne({
    assessment,
    'previous.reference': reference,
    status: 'done',
  })
    .sort(NEWEST)
    .lean<Stored>()
}

async function latestRuns(assessment: Types.ObjectId, reference: string) {
  const [done, failed] = await Promise.all([
    latestDone(assessment, reference),
    ReportComparisonModel.findOne(
      { assessment, 'previous.reference': reference, status: 'failed' },
      'error createdAt',
    )
      .sort(NEWEST)
      .lean<Stored>(),
  ])
  return {
    done,
    failure:
      failed && (!done || isNewer(failed, done))
        ? { error: failed.error ?? 'The comparison failed.', at: failed.createdAt }
        : null,
  }
}

/**
 * Returns the Comparison tab: the site's earlier finalised reports, the one
 * compared against (`previous`, else the latest) and its latest comparison as
 * decided, out of date when the evidence changed.
 * Throws AssessmentNotFoundError, ComparisonError (403 for anyone but its
 * engineer and knowledge admins; 404 for a report that is not an earlier
 * finalised report of the site).
 */
export async function readComparison(
  reference: string,
  user: SessionUser,
  previous?: string,
): Promise<ComparisonPageDto> {
  const assessment = await openedAssessment(reference, user)
  const reports = await earlierFinalised(assessment)
  // The latest by default; the engineer can pick another (AC "Finding the previous report").
  const chosen = previous
    ? (reports.find((r) => r.reference === previous) ?? null)
    : (reports[0] ?? null)
  if (previous && !chosen)
    throw new ComparisonError(`${previous} is not an earlier finalised report of this site.`, 404)
  const observations = (await listObservations(reference)).length
  const canChange =
    String(assessment.engineer) === user.id &&
    hasPermission(user.role, 'reports:generate') &&
    !assessment.archivedAt
  const page: ComparisonPageDto = {
    reference,
    previousReports: reports.map(publicReport),
    previous: chosen && publicReport(chosen),
    canChange,
    readOnly: canChange ? null : assessment.archivedAt ? 'archived' : 'not_assigned',
    observations,
    comparison: null,
    failure: null,
    running: running.has(String(assessment._id)),
  }
  if (!chosen) return page
  const { done, failure } = await latestRuns(assessment._id, chosen.reference)
  page.failure = failure
  // Section names are kept on the comparison, so reading needs no S4 call.
  if (done) page.comparison = toDto(done, await currentSources(assessment, []))
  return page
}

/**
 * Runs a comparison of the assessment with `previous`, one of the site's
 * earlier finalised reports, through S4, and returns the tab. Decisions on
 * the last comparison with that report are kept where their evidence did not
 * change; the rest are flagged for another look. Throws ComparisonError (404
 * not an earlier finalised report; 409 no observation, nothing to compare, or
 * a run under way), NotAssignedError, AssessmentArchivedError, and
 * ComparisonRunError when S4 failed (kept as a failed run, with its time; the
 * last comparison stays).
 */
export async function runComparison(
  reference: string,
  user: SessionUser,
  previous: string,
): Promise<ComparisonPageDto> {
  const assessment = await openedAssessment(reference, user)
  checkCanChange(assessment, user)
  const chosen = (await earlierFinalised(assessment)).find((r) => r.reference === previous)
  if (!chosen)
    throw new ComparisonError(`${previous} is not an earlier finalised report of this site.`, 404)
  if (!(await listObservations(reference)).length)
    throw new ComparisonError(
      'Save at least one observation, then you can compare with the previous report.',
      409,
    )
  const key = String(assessment._id)
  if (running.has(key)) throw new ComparisonError('A comparison is already running.', 409)
  running.add(key)
  const record = {
    assessment: assessment._id,
    previous: {
      assessment: chosen.id,
      reference: chosen.reference,
      siteVisitDate: chosen.siteVisitDate,
      engineer: chosen.engineerId ? { id: chosen.engineerId, name: chosen.engineer ?? '' } : null,
    },
    createdBy: { id: user.id, name: user.name },
    metadata: {
      source_type: 'report_comparison' as const,
      jurisdiction: assessment.site.jurisdiction,
      facility_type: assessment.site.facilityType,
      COPE_dimension: 'all' as const,
      effective_date: new Date(),
    },
  }
  try {
    const templates = await listTemplateSections()
    const [items, sources] = await Promise.all([
      previousItems(chosen, templates),
      currentSources(assessment, templates),
    ])
    if (!items.length)
      throw new ComparisonError(
        `${chosen.reference} has no findings or recommendations to compare with.`,
        409,
      )
    if (!sources.length)
      throw new ComparisonError(
        'Add a note, recording or handwritten page to an observation, then you can compare.',
        409,
      )
    const result = await requestReportComparison({
      previous: items.map(previousWire),
      current: sources.map(currentWire),
      privacy: await privacyFor(reference),
    })
    await recordAiCalls(hyphenated(result.usage), { reportId: reference, userId: user.id })
    const byLabel = new Map(sources.map((s) => [s.label, s]))
    const settled = items.flatMap((p) => {
      const suggested = result.items.find((r) => r.previous === p.label)
      return suggested ? [settleItem(suggested, p, byLabel)] : []
    })
    if (settled.length !== items.length)
      throw new RagServiceError('The comparison came back without every previous item.', 502)
    const last = await latestDone(assessment._id, chosen.reference)
    const carried = last ? carryDecisions(last, settled, sources) : { decisions: [], recheck: [] }
    const now = new Date()
    await ReportComparisonModel.create({
      ...record,
      status: 'done',
      error: null,
      previousItems: items,
      sources,
      items: settled,
      recheck: carried.recheck,
      decisions: carried.decisions,
      dropped: result.dropped,
      provenance: {
        provider: result.provenance.provider,
        model: result.provenance.model,
        effort: result.provenance.effort,
        prompt_version: result.provenance.prompt_version,
        rules_version: COMPARISON_RULES,
        generated_at: now,
        privacy: result.provenance.privacy,
      },
    })
  } catch (error: unknown) {
    if (!(error instanceof RagServiceError)) throw error
    const failed = await ReportComparisonModel.create({
      ...record,
      status: 'failed',
      error: error.message,
      previousItems: [],
      sources: [],
      items: [],
      provenance: null,
    })
    throw new ComparisonRunError(error.message, failed.createdAt)
  } finally {
    running.delete(key)
  }
  return readComparison(reference, user, chosen.reference)
}

// ---- Deciding ---------------------------------------------------------------

export const MAX_NOTE_LENGTH = 500

export const decisionSchema = z.strictObject({
  action: z.enum(['accept', 'outcome', 'pair', 'unpair', 'dismiss', 'restore']),
  outcome: z.enum(COMPARISON_OUTCOMES).optional(),
  // For pair: the current sources it is compared with now. For unpair: those
  // to take away (all when left out).
  sources: z.array(z.string().min(1).max(200)).max(50).optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
})
export type DecisionInput = z.infer<typeof decisionSchema>

const refuse = (message: string, field?: string) =>
  new ComparisonError(message, 400, field ? { [field]: message } : {})

/**
 * Records the engineer's decision on one item of the latest comparison and
 * returns the tab. Each decision records the item's whole state after it,
 * with who and when:
 * - accept: the outcome it shows (one whose sources disagree needs an outcome chosen first);
 * - outcome: another outcome; Fixed with no current source needs a short note;
 * - pair: the current sources it is compared with now, and its outcome;
 * - unpair: takes sources away (all when none are named); with none left, an
 *   outcome that needs a source becomes Not checked unless one is given;
 * - dismiss and restore: out of the counts and back.
 * Throws ComparisonError (400 invalid, 404 unknown comparison or item, 409 not
 * the latest comparison), NotAssignedError, AssessmentArchivedError.
 */
export async function decideItem(
  reference: string,
  comparisonId: string,
  itemKey: string,
  input: DecisionInput,
  user: SessionUser,
): Promise<ComparisonPageDto> {
  const assessment = await openedAssessment(reference, user)
  checkCanChange(assessment, user)
  const comparison = Types.ObjectId.isValid(comparisonId)
    ? await ReportComparisonModel.findOne({
        _id: comparisonId,
        assessment: assessment._id,
        status: 'done',
      }).lean<Stored>()
    : null
  if (!comparison) throw new ComparisonError('That comparison no longer exists.', 404)
  const latest = await latestDone(assessment._id, comparison.previous.reference)
  if (latest && String(latest._id) !== String(comparison._id))
    throw new ComparisonError(
      'This assessment was compared again since. Reload to decide on the latest comparison.',
      409,
    )
  const item = foldComparison(comparison).items.find((i) => i.key === itemKey)
  if (!item) throw new ComparisonError('That item is not in this comparison.', 404)
  const known = new Set(comparison.sources.map((s) => s.key))
  let outcome: ItemOutcome | null = item.outcome
  let sources = item.sources
  let dismissed = item.dismissed
  // Accepting, dismissing or restoring keeps the note the item was decided with.
  const choosing =
    input.action === 'outcome' || input.action === 'pair' || input.action === 'unpair'
  const note = input.note || (choosing ? null : (item.decided?.note ?? null))
  const isNew = item.kind === 'new'
  if (input.action === 'accept') {
    if (!outcome) throw refuse('Its sources disagree, so choose an outcome first.', 'outcome')
  } else if (input.action === 'outcome' || input.action === 'pair') {
    if (isNew)
      throw refuse(
        'A new item is paired from the previous report’s item it matches, not changed itself.',
      )
    if (input.action === 'pair') {
      const chosen = [...new Set(input.sources ?? [])]
      if (chosen.some((k) => !known.has(k)))
        throw refuse('Choose current sources from this comparison.', 'sources')
      sources = chosen
    }
    outcome = input.outcome ?? outcome
    if (!outcome) throw refuse('Choose an outcome.', 'outcome')
  } else if (input.action === 'unpair') {
    if (isNew) throw refuse('A new item has nothing to unpair.')
    const away = new Set(input.sources ?? sources)
    sources = sources.filter((k) => !away.has(k))
    outcome = input.outcome ?? (sources.length ? outcome : 'not_checked')
    if (!outcome) throw refuse('Choose an outcome.', 'outcome')
  } else {
    // Hiding a hidden item, or showing a shown one, changes nothing, so records nothing.
    if (dismissed === (input.action === 'dismiss'))
      return readComparison(reference, user, comparison.previous.reference)
    dismissed = input.action === 'dismiss'
  }
  if (outcome === 'not_checked' && sources.length)
    throw refuse(
      'An item compared with current evidence can’t be not checked. Unpair it first.',
      'outcome',
    )
  // Silence is not a fix: Fixed with nothing current behind it says how it is known.
  if (outcome === 'fixed' && !sources.length && !note && (choosing || input.action === 'accept'))
    throw refuse('Add a short note saying how you know it was fixed.', 'note')
  const decision: IComparisonDecision = {
    item: item.key,
    action: input.action,
    outcome: outcome as ComparisonOutcome | 'new' | null,
    sources,
    note,
    dismissed,
    carriedFrom: null,
    by: { id: user.id, name: user.name },
    at: new Date(),
  }
  await ReportComparisonModel.updateOne({ _id: comparison._id }, { $push: { decisions: decision } })
  return readComparison(reference, user, comparison.previous.reference)
}
