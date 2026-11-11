// MarshBot's routes (AS-06), mounted at /api/assessments/:reference/assistant:
// the brief, quick replies, dismissals and activity. Reading needs an
// assessment the caller can open (its engineer or a knowledge admin); the rest
// are the assigned engineer's. 403 not theirs, 404 unknown, 409 archived, a
// reply not asked for, or a Fix now dismissal. Calls services/assistant/brief.service.ts
// and replies.service.ts.
import { Router, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import { CannotOpenAssessmentError } from '../services/comment.service'
import {
  activitySchema,
  dismissalSchema,
  dismissItem,
  FixNowItemError,
  getBrief,
  ItemNotFoundError,
  postActivity,
} from '../services/assistant/brief.service'
import {
  InvalidReplyError,
  postReply,
  ReplyNotAskedError,
  replySchema,
} from '../services/assistant/replies.service'
import { requirePermission } from '../middleware/auth.middleware'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })
type Params = { reference: string }

// Answers a refused request with its status; rethrows anything else.
function refuse(error: unknown, res: Response) {
  const status =
    error instanceof CannotOpenAssessmentError || error instanceof NotAssignedError
      ? 403
      : error instanceof AssessmentNotFoundError || error instanceof ItemNotFoundError
        ? 404
        : error instanceof AssessmentArchivedError ||
            error instanceof ReplyNotAskedError ||
            error instanceof FixNowItemError
          ? 409
          : error instanceof InvalidReplyError
            ? 400
            : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

// The brief as the caller sees it (AC 1, AC 11).
router.get('/', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await getBrief((req.params as Params).reference, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// A quick reply: `{ replyId, date? }`. 200 with the brief after it.
router.post('/replies', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = replySchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The reply could not be read.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    res.json(await postReply((req.params as Params).reference, res.locals.user!, parsed.data))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Dismisses an item until it changes (AC 6): `{ itemId }`. 204.
router.post('/dismissals', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = dismissalSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The dismissal could not be read.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await dismissItem((req.params as Params).reference, res.locals.user!, parsed.data.itemId)
    res.status(204).end()
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// The browser's activity counts (Architecture 5), sent with sendBeacon. 204.
router.post('/activity', requirePermission('assessments:view'), async (req, res) => {
  const parsed = activitySchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The activity could not be read.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await postActivity((req.params as Params).reference, res.locals.user!, parsed.data)
    res.status(204).end()
  } catch (error: unknown) {
    refuse(error, res)
  }
})

export default router
