// EV-01: runs the deterministic checks on an assessment's drafted sections and
// saves the run. Called by routes/assessment.routes.ts. Reads the drafts
// (report-section.model), observations, and asks rag.service for passages and
// the template. It never calls a paid model.
import { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import {
  EvaluationRunModel,
  type IEvaluationCheck,
  type IEvaluationRun,
} from '../models/evaluation-run.model'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel, type IReportSection } from '../models/report-section.model'
import type { ISite } from '../models/site.model'
import { NotAssignedError } from './assessment.service'
import type { SessionUser } from './auth.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { COMPULSORY_HEADINGS, HEADING_ALIASES, REQUIRED_SECTIONS } from './evidence-check.config'
import { checkChunksExist, getTemplate, RagServiceError, type TemplateSection } from './rag.service'

export type EvaluationRunDto = {
  id: string
  reference: string
  createdAt: Date
  templateVersion: string
  summary: IEvaluationRun['summary']
  checks: IEvaluationCheck[]
}

type Draft = IReportSection & { _id: Types.ObjectId }

// The statements a finding check applies to: narrative and fields subsections.
// Table subsections hold no drafted text yet (GN-03).
function findings(draft: Draft) {
  return draft.subsections
    .filter((s) => s.kind !== 'table')
    .flatMap((s) =>
      s.statements.map((st, i) => ({ target: `${s.heading} #${i + 1}`, statement: st })),
    )
}

// AC2: a finding passes the evidence check when it cites something.
function findingChecks(sectionId: string, draft: Draft): IEvaluationCheck[] {
  return findings(draft).map(({ target, statement }) => ({
    sectionId,
    check: 'finding-has-evidence',
    target,
    ...(statement.citations.length
      ? { result: 'pass', detail: `${statement.citations.length} citation(s)` }
      : { result: 'fail', detail: 'No citation or observation link.' }),
  }))
}

type Resolution = { result: IEvaluationCheck['result']; detail: string }

// AC1: observation citations (O:<id>) must be live observations of this assessment.
async function resolveObservations(
  ids: string[],
  assessmentId: Types.ObjectId,
): Promise<Map<string, Resolution>> {
  const valid = ids.filter((c) => Types.ObjectId.isValid(c.slice(2)))
  const rows = await ObservationModel.find(
    { _id: { $in: valid.map((c) => c.slice(2)) } },
    { assessment: 1, deleted: 1 },
  ).lean()
  const byId = new Map(rows.map((r) => [String(r._id), r]))
  return new Map(
    ids.map((citation): [string, Resolution] => {
      const row = byId.get(citation.slice(2))
      if (!valid.includes(citation))
        return [citation, { result: 'fail', detail: 'Not a valid observation id.' }]
      if (!row) return [citation, { result: 'fail', detail: 'No observation with this id.' }]
      if (!assessmentId.equals(row.assessment))
        return [citation, { result: 'fail', detail: 'Not an observation of this assessment.' }]
      if (row.deleted) return [citation, { result: 'fail', detail: 'The observation was deleted.' }]
      return [citation, { result: 'pass', detail: 'Observation of this assessment.' }]
    }),
  )
}

// AC1: passage citations (C:/P:) must exist in the knowledge base, withdrawn
// documents included. If the lookup is down the answer is "unverified": a check
// must never pass because something was unavailable.
async function resolvePassages(ids: string[]): Promise<Map<string, Resolution>> {
  const resolved = new Map<string, Resolution>()
  if (!ids.length) return resolved
  try {
    for (const hit of await checkChunksExist(ids)) {
      if (!hit.exists) {
        resolved.set(hit.id, { result: 'fail', detail: 'Passage not found in the knowledge base.' })
        continue
      }
      const note =
        hit.status && hit.status !== 'active' ? ` (document ${hit.status.replace('_', ' ')})` : ''
      resolved.set(hit.id, { result: 'pass', detail: `Found in document ${hit.doc_id}${note}.` })
    }
  } catch (error) {
    if (!(error instanceof RagServiceError)) throw error
    for (const id of ids) {
      resolved.set(id, { result: 'unverified', detail: 'The passage lookup was unavailable.' })
    }
  }
  return resolved
}

async function citationChecks(
  drafts: Map<string, Draft>,
  assessmentId: Types.ObjectId,
): Promise<IEvaluationCheck[]> {
  const cited = [
    ...new Set(
      [...drafts.values()].flatMap((d) => findings(d).flatMap((f) => f.statement.citations)),
    ),
  ]
  const resolutions = new Map<string, Resolution>([
    ...(await resolveObservations(
      cited.filter((c) => c.startsWith('O:')),
      assessmentId,
    )),
    ...(await resolvePassages(cited.filter((c) => c.startsWith('C:') || c.startsWith('P:')))),
  ])
  return [...drafts].flatMap(([sectionId, draft]) =>
    [...new Set(findings(draft).flatMap((f) => f.statement.citations))].map((citation) => ({
      sectionId,
      check: 'citation-resolves' as const,
      target: citation,
      ...(resolutions.get(citation) ?? {
        result: 'fail' as const,
        detail: 'Unrecognised citation.',
      }),
    })),
  )
}

// Headings compare without case or extra spaces, and known Marsh wordings count as the template's.
const norm = (heading: string) => {
  const key = heading.toLowerCase().replace(/\s+/g, ' ').trim()
  return HEADING_ALIASES[key] ?? key
}

// AC3: one check per template section: is there a draft? A missing section is
// named, as a failure or (for section 12) a warning.
function requiredSectionCheck(
  section: TemplateSection,
  draft: Draft | undefined,
): IEvaluationCheck {
  const base = {
    sectionId: section.id,
    check: 'required-section' as const,
    target: `${section.id} ${section.title}`,
  }
  if (draft) return { ...base, result: 'pass', detail: 'A draft exists.' }
  return {
    ...base,
    result: REQUIRED_SECTIONS[section.id] ?? 'fail',
    detail: 'No draft for this section.',
  }
}

// AC4: compare the draft's headings with the template's. A missing compulsory
// heading or a wrong order fails; anything else that differs warns.
function headingChecks(
  section: TemplateSection,
  draft: Draft,
  templateVersion: string,
): IEvaluationCheck[] {
  if (!section.subsections) return []
  const make = (
    target: string,
    result: IEvaluationCheck['result'],
    detail: string,
  ): IEvaluationCheck => ({
    sectionId: section.id,
    check: 'heading-structure',
    target,
    result,
    detail,
  })
  const expected = section.subsections.map((s) => s.heading)
  const actual = draft.subsections.map((s) => s.heading)
  const expectedKeys = expected.map(norm)
  const actualKeys = actual.map(norm)
  const compulsory = (COMPULSORY_HEADINGS[section.id] ?? []).map(norm)

  const checks: IEvaluationCheck[] = []
  expected.forEach((heading, i) => {
    if (!actualKeys.includes(expectedKeys[i])) {
      checks.push(
        make(heading, compulsory.includes(expectedKeys[i]) ? 'fail' : 'warn', 'Missing heading.'),
      )
    }
  })
  actual.forEach((heading, i) => {
    if (!expectedKeys.includes(actualKeys[i])) {
      checks.push(make(heading, 'warn', 'Heading is not in the template.'))
    }
  })
  const sharedInTemplate = expectedKeys.filter((k) => actualKeys.includes(k))
  const sharedInDraft = actualKeys.filter((k) => expectedKeys.includes(k))
  if (sharedInTemplate.join('|') !== sharedInDraft.join('|')) {
    checks.push(make('order', 'fail', 'Headings are not in the template order.'))
  }
  const written = draft.provenance.template_version
  if (written !== templateVersion) {
    checks.push(
      make(
        'template-version',
        'warn',
        `Written with template ${written}; the current one is ${templateVersion}.`,
      ),
    )
  }
  return checks.length ? checks : [make('headings', 'pass', 'Headings match the template.')]
}

const toDto = (run: IEvaluationRun & { _id: Types.ObjectId }): EvaluationRunDto => ({
  id: String(run._id),
  reference: run.reference,
  createdAt: run.createdAt,
  templateVersion: run.templateVersion,
  summary: run.summary,
  checks: run.checks,
})

/** Runs every check on the assessment's latest drafts, saves the run, and returns it. */
export async function runEvaluation(
  reference: string,
  user: SessionUser,
): Promise<EvaluationRunDto> {
  // a. Who and what: only the assigned engineer runs the checks, like drafting.
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()

  // b. The template (needs rag-service) and the newest draft of each section.
  const template = await getTemplate()
  const all = await ReportSectionModel.find({ assessment: assessment._id })
    .sort({ createdAt: -1 })
    .lean<Draft[]>()
  const drafts = new Map<string, Draft>()
  for (const section of template.sections) {
    const latest = all.find((d) => d.sectionId === section.id)
    if (latest) drafts.set(section.id, latest)
  }

  // c. The checks.
  const checks = [
    ...template.sections.flatMap((section) => {
      const found = drafts.get(section.id)
      return [
        requiredSectionCheck(section, found),
        ...(found ? headingChecks(section, found, template.template_version) : []),
      ]
    }),
    ...[...drafts].flatMap(([sectionId, draft]) => findingChecks(sectionId, draft)),
    ...(await citationChecks(drafts, assessment._id)),
  ]

  // d. Save the run with its counts.
  const count = (result: IEvaluationCheck['result']) =>
    checks.filter((c) => c.result === result).length
  const saved = await EvaluationRunModel.create({
    assessment: assessment._id,
    reference,
    createdBy: user.id,
    templateVersion: template.template_version,
    summary: {
      passed: count('pass'),
      failed: count('fail'),
      warned: count('warn'),
      unverified: count('unverified'),
      status: count('unverified') ? 'incomplete' : 'complete',
    },
    checks,
    metadata: {
      source_type: 'evaluation_run',
      jurisdiction: assessment.site?.jurisdiction ?? 'all',
      facility_type: assessment.site?.facilityType ?? 'all',
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
  return toDto(saved.toObject())
}

/** Returns the newest saved run for the assessment, or null if none has been run. */
export async function latestEvaluation(reference: string): Promise<EvaluationRunDto | null> {
  if (!(await AssessmentModel.exists({ reference }))) throw new AssessmentNotFoundError(reference)
  const run = await EvaluationRunModel.findOne({ reference }).sort({ createdAt: -1 }).lean()
  return run ? toDto(run) : null
}
