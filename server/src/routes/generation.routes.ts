// Generation's routes (GN-13): read the drafting state, start a drafting run,
// and draft one part again from Review, in the background. Mounted in index.ts
// at /api/assessments/:reference/generation. Calls services/generation/.
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { canOpenAssessment, NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import {
  DraftingRunActiveError,
  draftPartFromReview,
  NothingToDraftError,
  PartBusyError,
  PartInRunError,
  startDraftingRun,
  UnknownPartError,
} from '../services/generation/drafting-run.service'
import { getGeneration } from '../services/generation/generation.service'
import { RagServiceError } from '../services/rag.service'
import {
  NotDraftedError,
  regenerateSchema,
  ReplacementPendingError,
} from '../services/review-decision.service'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

// What each refusal answers, as the old drafting routes do: 404, 403 for anyone
// but the assigned engineer, 409 when it can't happen now, 503 when S4 (which
// lists the template's sections) can't be reached.
function generationFailure(error: unknown, res: Response) {
  if (error instanceof AssessmentNotFoundError || error instanceof UnknownPartError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof NotAssignedError) {
    res.status(403).json({ error: error.message })
  } else if (
    error instanceof AssessmentArchivedError ||
    error instanceof DraftingRunActiveError ||
    error instanceof NothingToDraftError ||
    error instanceof PartBusyError ||
    error instanceof PartInRunError ||
    error instanceof NotDraftedError ||
    error instanceof ReplacementPendingError
  ) {
    res.status(409).json({ error: error.message })
  } else if (error instanceof RagServiceError) {
    res.status(503).json({ error: error.message })
  } else {
    throw error
  }
}

// The drafting state, for the assigned engineer or an admin, who watches (AC11).
router.get('/', requirePermission('assessments:view'), async (req, res) => {
  const user = res.locals.user!
  const { reference } = req.params as { reference: string }
  const allowed = await canOpenAssessment(reference, user)
  if (allowed === null) {
    res.status(404).json({ error: 'Assessment not found.' })
    return
  }
  if (!allowed) {
    res.status(403).json({ error: 'Only the assigned engineer or an admin can open this.' })
    return
  }
  try {
    res.json(await getGeneration(reference, user))
  } catch (error: unknown) {
    generationFailure(error, res)
  }
})

// Starts the drafting run the checkpoint offers: 202 with the state, the run queued.
router.post('/run', requirePermission('reports:generate'), async (req, res) => {
  const { reference } = req.params as { reference: string }
  try {
    res.status(202).json(await startDraftingRun(reference, res.locals.user!))
  } catch (error: unknown) {
    generationFailure(error, res)
  }
})

// Drafts one part again from Review: 202 with the state, the part queued.
router.post('/parts/:partId', requirePermission('reports:generate'), async (req, res) => {
  const parsed = regenerateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The instruction is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  const { reference, partId } = req.params as { reference: string; partId: string }
  try {
    res
      .status(202)
      .json(await draftPartFromReview(reference, partId, parsed.data.instruction, res.locals.user!))
  } catch (error: unknown) {
    generationFailure(error, res)
  }
})

export default router
