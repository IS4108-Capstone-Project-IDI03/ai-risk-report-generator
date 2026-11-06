// Comment threads on an assessment's report (RV-03), mounted at
// /api/assessments/:reference/comments. Reading and writing threads needs
// `reports:comment` (both roles, F-05) and an assessment the caller can open:
// its assigned engineer or a knowledge admin (403 otherwise). Moving anchors
// after a save of the text needs `reports:generate`, as saving it does.
import { Router, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
} from '../services/capture-session.service'
import {
  anchorsSchema,
  CannotOpenAssessmentError,
  commentInputSchema,
  CommentNotFoundError,
  createThread,
  deleteComment,
  editComment,
  listThreads,
  moveAnchors,
  newThreadSchema,
  NotYourCommentError,
  replyTo,
  setThreadStatus,
  ThreadFullError,
  ThreadNotFoundError,
} from '../services/comment.service'
import { requirePermission } from '../middleware/auth.middleware'
import { fieldErrors } from './field-errors'

const router = Router({ mergeParams: true })

type Params = { reference: string }
type ThreadParams = Params & { threadId: string }

// Answers a refused request with its status: 403 when the caller cannot open
// the assessment or the comment is not theirs, 404 unknown, 409 archived or a
// full thread. Rethrows anything else.
function refuse(error: unknown, res: Response) {
  const status =
    error instanceof CannotOpenAssessmentError ||
    error instanceof NotYourCommentError ||
    error instanceof NotAssignedError
      ? 403
      : error instanceof AssessmentNotFoundError ||
          error instanceof ThreadNotFoundError ||
          error instanceof CommentNotFoundError
        ? 404
        : error instanceof AssessmentArchivedError || error instanceof ThreadFullError
          ? 409
          : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

const invalid = (res: Response, error: Parameters<typeof fieldErrors>[0], what: string) =>
  res.status(400).json({ error: what, fields: fieldErrors(error) })

// Every thread on the report, oldest first: `{ threads }`.
router.get('/', requirePermission('reports:comment'), async (req, res) => {
  try {
    res.json(await listThreads((req.params as Params).reference, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Starts a thread (AC1): `{ anchor, body }`. 201 with `{ thread }`.
router.post('/', requirePermission('reports:comment'), async (req, res) => {
  const parsed = newThreadSchema.safeParse(req.body)
  if (!parsed.success) {
    invalid(res, parsed.error, 'The comment could not be read.')
    return
  }
  try {
    res
      .status(201)
      .json(await createThread((req.params as Params).reference, parsed.data, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Moves threads to where the document editor's save left their text (AC6):
// `{ anchors: [{ id, anchor | null }] }`. 200 with `{ updated }`.
router.put('/anchors', requirePermission('reports:generate'), async (req, res) => {
  const parsed = anchorsSchema.safeParse(req.body)
  if (!parsed.success) {
    invalid(res, parsed.error, 'The anchors could not be read.')
    return
  }
  try {
    res.json(await moveAnchors((req.params as Params).reference, parsed.data, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// A reply (AC2): `{ body }`. 201 with `{ thread }`.
router.post('/:threadId/replies', requirePermission('reports:comment'), async (req, res) => {
  const parsed = commentInputSchema.safeParse(req.body)
  if (!parsed.success) {
    invalid(res, parsed.error, 'The reply could not be read.')
    return
  }
  const { reference, threadId } = req.params as ThreadParams
  try {
    res.status(201).json(await replyTo(reference, threadId, parsed.data, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Edits the caller's own comment (AC3): `{ body }`. 200 with `{ thread }`.
router.patch(
  '/:threadId/comments/:commentId',
  requirePermission('reports:comment'),
  async (req, res) => {
    const parsed = commentInputSchema.safeParse(req.body)
    if (!parsed.success) {
      invalid(res, parsed.error, 'The comment could not be read.')
      return
    }
    const { reference, threadId, commentId } = req.params as ThreadParams & { commentId: string }
    try {
      res.json(await editComment(reference, threadId, commentId, parsed.data, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Deletes the caller's own comment (AC3): 200 with `{ thread }`, null once
// the thread has no comment left.
router.delete(
  '/:threadId/comments/:commentId',
  requirePermission('reports:comment'),
  async (req, res) => {
    const { reference, threadId, commentId } = req.params as ThreadParams & { commentId: string }
    try {
      res.json(await deleteComment(reference, threadId, commentId, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Resolves a thread, or reopens it (AC5): 200 with `{ thread }`.
for (const [action, status] of [
  ['resolve', 'resolved'],
  ['reopen', 'open'],
] as const) {
  router.post(`/:threadId/${action}`, requirePermission('reports:comment'), async (req, res) => {
    const { reference, threadId } = req.params as ThreadParams
    try {
      res.json(await setThreadStatus(reference, threadId, status, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  })
}

export default router
