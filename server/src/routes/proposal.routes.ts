// Text drafted or rewritten from the Ask tab (AS-04), mounted at
// /api/assessments/:reference/proposals. A proposal is made by asking (POST
// …/ask with `propose`, routes/ask.routes.ts); these put it into the report
// and decide on it there. All need `reports:generate` (risk engineers; a
// knowledge admin gets 403, AC5) and the assigned engineer (403), on an
// assessment neither archived nor finalised (409). No session is a 401
// (requireAuth). Each answers 200 with `{ proposal, workspace }`: the
// proposal as the Ask tab shows it, and the review workspace as it now stands.
// Refusals carry `{ error, cause, next, at, code }`, `code` `stale` when the
// section changed since (AC6): the browser then offers to draft it again.
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import { SectionRedraftingError } from '../services/generation/drafting-run.service'
import { RagServiceError } from '../services/rag.service'
import { DocumentShapeError } from '../services/report-document.service'
import { ConcurrentDecisionError, FindingStateError } from '../services/review-decision.service'
import { UnknownSectionError } from '../services/section.service'
import {
  applyProposal,
  insertSchema,
  ProposalRefusedError,
  settleProposal,
  undoProposal,
  type ApplyResult,
} from '../services/text-proposal.service'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

type Params = { reference: string; proposalId: string }

const stated = (error: string, cause: string, next: string, code?: string) => ({
  error,
  cause,
  next,
  at: new Date(),
  ...(code && { code }),
})

function refuse(error: unknown, res: Response) {
  if (error instanceof ProposalRefusedError) {
    res.status(error.status).json(stated(error.message, error.reason, error.next, error.code))
  } else if (error instanceof NotAssignedError) {
    res.status(403).json({ error: error.message })
  } else if (error instanceof AssessmentNotFoundError || error instanceof UnknownSectionError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof AssessmentArchivedError) {
    res
      .status(409)
      .json(
        stated(
          error.message,
          'the assessment is archived, so its report is read only',
          'Restore the assessment to change its report.',
          'archived',
        ),
      )
  } else if (error instanceof DocumentShapeError) {
    res.status(400).json({ error: error.message })
  } else if (error instanceof FindingStateError || error instanceof ConcurrentDecisionError) {
    res.status(409).json(stated(error.message, error.message, 'Reload the review workspace.'))
  } else if (error instanceof SectionRedraftingError) {
    res
      .status(409)
      .json(stated(error.message, 'the section is being redrafted', 'Try again once it is ready.'))
  } else if (error instanceof RagServiceError) {
    res.status(503).json({ error: error.message })
  } else {
    throw error
  }
}

const run = async (res: Response, act: () => Promise<ApplyResult>) => {
  try {
    res.json(await act())
  } catch (error: unknown) {
    refuse(error, res)
  }
}

// Insert (AC2): a draft's paragraphs at the end of its subsection, or of the
// one chosen as `{ subsection }`, as AI-drafted text awaiting Accept.
router.post('/:proposalId/insert', requirePermission('reports:generate'), async (req, res) => {
  const parsed = insertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose where to insert it.', fields: fieldErrors(parsed.error) })
    return
  }
  const { reference, proposalId } = req.params as Params
  await run(res, () =>
    applyProposal(reference, proposalId, 'insert', res.locals.user!, parsed.data.subsection),
  )
})

// Replace (AC1, AC2): a rewrite's paragraphs in place of those it rewrote.
router.post('/:proposalId/replace', requirePermission('reports:generate'), async (req, res) => {
  const { reference, proposalId } = req.params as Params
  await run(res, () => applyProposal(reference, proposalId, 'replace', res.locals.user!))
})

// Undo (AC2): the section's text from before the Insert or Replace, while
// nothing changed since.
router.post('/:proposalId/undo', requirePermission('reports:generate'), async (req, res) => {
  const { reference, proposalId } = req.params as Params
  await run(res, () => undoProposal(reference, proposalId, res.locals.user!))
})

// Accept (refused while a sentence is unsupported, AC3) or Delete the
// proposal's AI-drafted text in its section.
for (const action of ['accept', 'delete'] as const) {
  router.post(`/:proposalId/${action}`, requirePermission('reports:generate'), async (req, res) => {
    const { reference, proposalId } = req.params as Params
    await run(res, () => settleProposal(reference, proposalId, action, res.locals.user!))
  })
}

export default router
