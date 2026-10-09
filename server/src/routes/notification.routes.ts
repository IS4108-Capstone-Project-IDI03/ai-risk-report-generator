// The header dropdown's API: list the signed-in user's notifications, mark one
// or all read, dismiss them all. Each handler reads res.locals.user (set by
// requireAuth, mounted in index.ts) and leaves the work to
// notification.service.ts. No requirePermission: these are scoped to the
// caller's own session, like /api/auth/me, not to a role capability.
import { Router } from 'express'
import { z } from 'zod'
import {
  dismissAllForUser,
  listForUser,
  markAllReadForUser,
  markAsRead,
  NotificationNotFoundError,
} from '../services/notification.service'
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

// One page of the caller's notifications, with the totals the dropdown needs.
// An oversized limit is capped to MAX_LIMIT by the client, so the server only
// has to clamp (not reject) a large limit and reject one it cannot interpret.
router.get('/', async (req, res) => {
  const parsed = pageSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'The page is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  const { limit, offset } = parsed.data
  res.json(await listForUser(res.locals.user!, limit, offset))
})

// Marks one notification read for the caller. 404 for an id that is malformed,
// unknown or outside what the caller may see — the service draws no
// distinction, so the call cannot probe for notifications meant for others.
router.patch('/:id/read', async (req, res) => {
  try {
    await markAsRead(req.params.id, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    if (error instanceof NotificationNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// Marks everything the caller can see as read, clearing the badge while
// leaving the list in place.
router.post('/read-all', async (_req, res) => {
  await markAllReadForUser(res.locals.user!)
  res.status(204).end()
})

// Clears the caller's list. Per user: another user in the role still sees them.
router.post('/dismiss-all', async (_req, res) => {
  await dismissAllForUser(res.locals.user!)
  res.status(204).end()
})

export default router
