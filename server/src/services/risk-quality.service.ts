// Section 4 Risk Quality Ratings (GN-03): the engineer's seven category scores,
// and the location score and rating computed from them by fixed rules, so no
// rating comes from the language model (AC10). Called by routes/assessment.routes.ts
// and section.service.ts.
import { Types } from 'mongoose'
import { z } from 'zod'
import { AssessmentModel, type IAssessment } from '../models/assessment.model'
import type { SessionUser } from './auth.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { assessmentToDraft } from './section.service'

// Marsh's main categories, in the template's order (Global PRE Report Template
// v2.0, p. 10). Keep in step with the client's RQR_CATEGORIES (reviewDisplay.ts).
export const RQR_CATEGORIES = [
  'External Exposure',
  'Fire Protection',
  'Occupancy Hazards',
  'Construction',
  'Water Supply',
  'Surveillance',
  'Management Programs',
] as const

// Marsh's rating legend (template p. 10), highest band first.
const LEGEND = [
  { rating: 'A', from: 85, band: 'A: 85 to 100' },
  { rating: 'B', from: 70, band: 'B: 70 to 84' },
  { rating: 'C', from: 51, band: 'C: 51 to 69' },
  { rating: 'D', from: 36, band: 'D: 36 to 50' },
  { rating: 'E', from: 0, band: 'E: 0 to 35' },
]

// ponytail: equal weights are provisional. Marsh's Global Risk Quality Rating
// spreadsheet weights its categories (and scores sub-categories); none of the
// sample reports' totals fit equal weights. Swap these, and the version, when
// Marsh sends it.
const RULES_VERSION = 'rqr-provisional-equal-v1'
const WEIGHTS = RQR_CATEGORIES.map((category) => ({ category, weight: 1 / 7 }))

export type CategoryScore = { category: string; current: number | null; potential: number | null }

// One side's score out of 100, to one decimal as the report shows it, banded on
// that shown value. Null while any category is not entered (AC1): never a guess.
function side(scores: (number | null)[]) {
  if (scores.some((s) => s === null)) return null
  const raw = WEIGHTS.reduce((sum, w, i) => sum + w.weight * scores[i]! * 10, 0)
  const score = Math.round(raw * 10) / 10
  const { rating, band } = LEGEND.find((l) => score >= l.from)!
  return { score, rating, band }
}

// The current and potential location score and rating (AC3), with the basis
// the engineer can inspect: the weights and the rules version.
export function rate(categories: CategoryScore[]) {
  const byName = new Map(categories.map((c) => [c.category, c]))
  const ordered = RQR_CATEGORIES.map((name) => byName.get(name))
  return {
    current: side(ordered.map((c) => c?.current ?? null)),
    potential: side(ordered.map((c) => c?.potential ?? null)),
    basis: { weights: WEIGHTS, legend: LEGEND.map((l) => l.band), rulesVersion: RULES_VERSION },
  }
}

// A score out of 10, kept to one decimal as the report shows it.
const score = z
  .number()
  .min(0)
  .max(10)
  .transform((n) => Math.round(n * 10) / 10)
  .nullable()

// All seven categories at once, each once; a score may be left empty (null)
// while the engineer is still deciding. A potential below the current score is a
// slip: the potential is what the site could reach.
export const riskQualitySchema = z.object({
  categories: z
    .array(
      z
        .object({ category: z.enum(RQR_CATEGORIES), current: score, potential: score })
        .refine((c) => c.current === null || c.potential === null || c.potential >= c.current, {
          message: 'The potential score cannot be below the current score.',
        }),
    )
    .length(RQR_CATEGORIES.length)
    .refine((cs) => new Set(cs.map((c) => c.category)).size === cs.length, {
      message: 'Each category appears once.',
    }),
})

// The scores as saved, in template order, with the rating computed from them now.
// Whether the engineer has entered any score: then no proposal is made (AC14).
export const scoresEntered = (saved: IAssessment['riskQuality']) =>
  (saved?.categories ?? []).some((c) => c.current != null || c.potential != null)

// A proposal waiting for the engineer: made since the figures were last saved. Any save
// confirms it, so a saved form is never refilled from it (GN-03 addendum AC14).
export function pendingProposal(saved?: { proposal?: unknown; updatedAt?: Date }) {
  const proposal = saved?.proposal as { proposedAt?: Date } | undefined
  if (!proposal?.proposedAt) return null
  return !saved?.updatedAt || new Date(proposal.proposedAt) > new Date(saved.updatedAt)
    ? proposal
    : null
}

function riskQualityOf(saved: IAssessment['riskQuality']) {
  const byName = new Map((saved?.categories ?? []).map((c) => [c.category, c]))
  const categories = RQR_CATEGORIES.map((category) => ({
    category,
    current: byName.get(category)?.current ?? null,
    potential: byName.get(category)?.potential ?? null,
  }))
  return {
    categories,
    // Computed from the entered scores only, never from the proposal (AC10, AC13).
    result: rate(categories),
    proposal: pendingProposal(saved),
    updatedAt: saved?.updatedAt ?? null,
  }
}

export async function getRiskQuality(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'riskQuality').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return riskQualityOf(assessment.riskQuality)
}

// Saves the scores. Only the assigned engineer can, while not archived.
export async function saveRiskQuality(
  reference: string,
  input: z.infer<typeof riskQualitySchema>,
  user: SessionUser,
) {
  const assessment = await assessmentToDraft(reference, user)
  const riskQuality = {
    categories: input.categories,
    updatedAt: new Date(),
    updatedBy: new Types.ObjectId(user.id),
  }
  // Field by field, so a proposal stays on record beside the confirmed scores.
  await AssessmentModel.updateOne(
    { _id: assessment._id },
    {
      $set: {
        'riskQuality.categories': riskQuality.categories,
        'riskQuality.updatedAt': riskQuality.updatedAt,
        'riskQuality.updatedBy': riskQuality.updatedBy,
      },
    },
  )
  return riskQualityOf({ ...riskQuality, proposal: assessment.riskQuality?.proposal })
}

// What drafting Section 4's comments is given (AC4): the computed scores and
// ratings, and each category's scores, one per line, for the model to use
// unchanged; or why it cannot be drafted yet (AC1). The rating lines' wording is
// read by rag-service's check_numbers_grounded: keep the two in step.
export function riskQualityFacts(saved: IAssessment['riskQuality']) {
  const { categories, result } = riskQualityOf(saved)
  const { current, potential } = result
  if (!current || !potential)
    return { missing: 'Enter all seven current and potential scores first.' }
  return {
    facts: [
      `Current Location Risk Quality Score: ${current.score}`,
      `Current Location Risk Quality Rating: ${current.rating}`,
      `Potential Location Risk Quality Score: ${potential.score}`,
      `Potential Location Risk Quality Rating: ${potential.rating}`,
      ...categories.map((c) => `${c.category}: current ${c.current}, potential ${c.potential}`),
    ].join('\n'),
  }
}
