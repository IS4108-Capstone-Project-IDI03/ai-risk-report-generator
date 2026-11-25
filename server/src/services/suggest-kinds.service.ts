// CP-36: suggests which tags a note fits (fact, info request, recommendation). Called by
// POST /:reference/suggest-kinds in assessment.routes.ts. Calls rag-service's /suggest-kinds.
// It only suggests: nothing is saved and the note is never rewritten.
import { z } from 'zod'
import { AssessmentModel } from '../models/assessment.model'
import { OBSERVATION_KINDS, type ObservationKind } from '../models/observation.model'
import { recordAiCalls } from './ai-usage.service'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { privacyFor } from './privacy.service'
import { requestSuggestKinds } from './rag.service'
import type { SessionUser } from './auth.service'

export const suggestKindsSchema = z.object({
  text: z
    .string('Write a note first.')
    .max(5000, 'The note must be 5,000 characters or fewer.')
    .refine((n) => n.trim().length > 0, 'Write a note first.'),
})

/**
 * Returns the tags the text fits, in a fixed order (Fact when unsure). Throws NotAssignedError,
 * AssessmentArchivedError, AssessmentNotFoundError and RagServiceError (503 means client details
 * could not be protected, so nothing was sent).
 */
export async function suggestKinds(
  reference: string,
  text: string,
  user: SessionUser,
): Promise<ObservationKind[]> {
  // a. Same rule as saving an observation: only the assigned engineer, not archived.
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError('Only the engineer assigned to this assessment can capture for it.')
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)

  // b. Raw text goes with `privacy`; rag masks inside and answers 503 if it cannot, so raw text
  // is never sent unprotected.
  const result = await requestSuggestKinds({ text, privacy: await privacyFor(reference) })
  if (Array.isArray(result.usage)) {
    await recordAiCalls(
      result.usage.map((u: object) => ({ ...u, feature: 'suggest-kinds' })),
      { reportId: reference, userId: user.id },
    )
  }

  // c. Keep only known tags, in the fixed order; an empty answer means Fact.
  const kinds = OBSERVATION_KINDS.filter((k) => result.kinds?.includes(k))
  return kinds.length ? kinds : ['fact']
}
