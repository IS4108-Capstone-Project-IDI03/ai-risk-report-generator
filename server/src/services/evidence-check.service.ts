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
import { checkChunksExist, getTemplate, RagServiceError } from './rag.service'

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
