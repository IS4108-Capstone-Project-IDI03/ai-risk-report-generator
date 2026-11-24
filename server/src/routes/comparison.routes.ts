// Comparing an assessment with the previous report for the same site (RV-13),
// mounted at /api/assessments/:reference/comparison. Reading needs
// `assessments:view` and an assessment the caller can open: its assigned
// engineer or a knowledge admin (403 otherwise). Running a comparison and
// deciding its items need `reports:generate` and the assigned engineer, on an
// assessment not archived (409). Nothing here changes the report.
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import {
  ComparisonError,
  ComparisonRunError,
  decideItem,
  decisionSchema,
  readComparison,
  runComparison,
} from '../services/report-comparison.service'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

type Params = { reference: string }
type ItemParams = Params & { comparisonId: string; item: string }

// Answers a refused request with its status, or rethrows anything else.
function refuse(error: unknown, res: Response) {
  if (error instanceof ComparisonError) {
    res.status(error.status).json({ error: error.message, fields: error.fields })
    return
  }
  // S4 failed: the reason and when, so the tab can offer Retry (AC "Failures").
  if (error instanceof ComparisonRunError) {
    res.status(503).json({ error: error.message, failedAt: error.at })
    return
  }
  const status =
    error instanceof NotAssignedError
      ? 403
      : error instanceof AssessmentNotFoundError
        ? 404
        : error instanceof AssessmentArchivedError
          ? 409
          : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

const previousOf = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

// The Comparison tab: `?previous=<reference>` picks the earlier report to show.
router.get('/', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(
      await readComparison(
        (req.params as Params).reference,
        res.locals.user!,
        previousOf(req.query.previous),
      ),
    )
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Compare with previous report: `{ previous }`. 201 with the tab, or 503 with
// the reason and `failedAt` when S4 failed.
router.post('/', requirePermission('reports:generate'), async (req, res) => {
  const previous = previousOf((req.body as { previous?: unknown } | undefined)?.previous)
  if (!previous) {
    res.status(400).json({
      error: 'Choose the report to compare with.',
      fields: { previous: 'Choose the report to compare with.' },
    })
    return
  }
  try {
    res
      .status(201)
      .json(await runComparison((req.params as Params).reference, res.locals.user!, previous))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// The engineer's decision on one item: `{ action, outcome?, sources?, note? }`.
// 200 with the tab.
router.post(
  '/:comparisonId/items/:item/decision',
  requirePermission('reports:generate'),
  async (req, res) => {
    const parsed = decisionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The decision could not be read.', fields: fieldErrors(parsed.error) })
      return
    }
    const { reference, comparisonId, item } = req.params as ItemParams
    try {
      res.json(await decideItem(reference, comparisonId, item, parsed.data, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

export default router
