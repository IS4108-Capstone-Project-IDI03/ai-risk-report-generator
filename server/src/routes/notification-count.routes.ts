// The notification count, for the header badge poller. Mounted in index.ts
// under requireAuthNoRefresh (not requireAuth) so that polling it on a timer
// cannot keep an idle session alive and defeat the F-07 inactivity logout.
// Returns only { total, unread, inboxTodo } — never the list — so it stays cheap to poll.
// `total` and `unread` count the bell; `inboxTodo` is the Inbox's To do count.
import { Router } from 'express'
import { countsForUser } from '../services/notification.service'

const router = Router()

router.get('/', async (_req, res) => {
  res.json(await countsForUser(res.locals.user!))
})

export default router
