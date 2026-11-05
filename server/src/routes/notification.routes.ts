// The bell's and the Inbox's API: list the signed-in user's notifications, open,
// tick, untick, bin or restore one, mark all read and dismiss all (bell only).
// Each handler reads res.locals.user (set by
// requireAuth, mounted in index.ts) and leaves the work to
// notification.service.ts. No requirePermission: these are scoped to the
// caller's own session, like /api/auth/me, not to a role capability.
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  dismissAllForUser,
  dismissForUser,
  listForUser,
  listQuerySchema,
  markAllReadForUser,
  markAsRead,
  markDone,
  NotificationNotFoundError,
  restoreForUser,
  unmarkDone,
} from '../services/notification.service'
import type { SessionUser } from '../services/auth.service'
import { fieldErrors } from './field-errors'

const router = Router()

// Largest page the gateway will serve, however large a limit the client asks
// for — a guard against one request pulling the whole collection.
const MAX_LIMIT = 50

// Paging from the query string. Both are optional; coerced from strings and
// bounded, so a missing, non-numeric or out-of-range value is a 400 naming the
// field rather than a surprise default.
const pageSchema = z.object({
  // Clamped to the cap, not rejected, so a client asking for more simply gets
  // the most the gateway will serve. Only a non-numeric or non-positive limit
  // is a 400.
  limit: z.coerce
    .number('limit must be a number.')
    .int('limit must be a whole number.')
    .min(1, 'limit must be at least 1.')
    .transform((value) => Math.min(value, MAX_LIMIT))
    .default(20),
  offset: z.coerce
    .number('offset must be a number.')
    .int('offset must be a whole number.')
    .min(0, 'offset cannot be negative.')
    .default(0),
})

// One page of the caller's bell (the default) or Inbox, with the totals the
// screens need. An oversized limit is clamped to MAX_LIMIT; a limit, offset,
// kind or tab the server cannot interpret is a 400 naming the field.
router.get('/', async (req, res) => {
  const parsed = pageSchema.and(listQuerySchema).safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'The page is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  const { limit, offset, kind, tab } = parsed.data
  res.json(await listForUser(res.locals.user!, limit, offset, { kind, tab }))
})

// Answers a single-notification change: 204 when done, 404 for an id that is
// malformed, unknown or outside what the caller may see — the service draws no
// distinction, so the call cannot probe for notifications meant for others.
function oneChange(change: (id: string, user: SessionUser) => Promise<void>) {
  return async (req: Request<{ id: string }>, res: Response) => {
    try {
      await change(req.params.id, res.locals.user!)
      res.status(204).end()
    } catch (error: unknown) {
      if (error instanceof NotificationNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      throw error
    }
  }
}

// Opens a notification for the caller: read, and on an Inbox item Done for them only.
router.patch('/:id/read', oneChange(markAsRead))

// Ticks an Inbox item without opening it: Done for everyone it is shared with.
router.post('/:id/done', oneChange(markDone))

// Unticks an Inbox item: back to To do for those who never opened it.
router.delete('/:id/done', oneChange(unmarkDone))

// Undoes a bin, for the caller only.
router.post('/:id/restore', oneChange(restoreForUser))

// Marks everything in the caller's bell as read, clearing the badge while
// leaving the list in place. Inbox items are not touched.
router.post('/read-all', async (_req, res) => {
  await markAllReadForUser(res.locals.user!)
  res.status(204).end()
})

// Clears the caller's bell. Per user: another user in the role still sees them.
// Inbox items are not touched.
router.post('/dismiss-all', async (_req, res) => {
  await dismissAllForUser(res.locals.user!)
  res.status(204).end()
})

// Bins one notification for the caller only. 404 as for opening it.
router.post('/:id/dismiss', oneChange(dismissForUser))

export default router
