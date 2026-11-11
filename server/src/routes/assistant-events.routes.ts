// MarshBot's push channel (AS-06, ADR .local-docs/adr/0002): a server-sent
// event stream that tells an open Overview its brief changed, so it never polls.
// Mounted in index.ts under requireAuthNoRefresh. Listens on assistant/bus.ts.
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { canOpenAssessment } from '../services/assessment.service'
import { onBriefChanged } from '../services/assistant/bus'

const router = Router({ mergeParams: true })

// A comment line every 25 s keeps proxies (nginx reads for 300 s) from closing a quiet stream.
const PING_MS = 25_000

// Opens the stream for the assessment's admin or assigned engineer; 404 or 403 otherwise.
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
  // a. Headers out now; X-Accel-Buffering stops nginx holding events back.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  // b. One event per brief change; the page then fetches the brief itself.
  const unsubscribe = onBriefChanged(reference, (updatedAt) =>
    res.write(`event: brief\ndata: ${JSON.stringify({ updatedAt })}\n\n`),
  )
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
  // c. Closed when the session expires, so a stream never outlives the 15-minute
  // sign-in; EventSource reconnects with whatever cookie the browser now holds.
  const exp = (user as { exp?: number }).exp
  const expire = setTimeout(() => res.end(), exp ? exp * 1000 - Date.now() : 0)
  // d. Without this, a closed tab would keep its listener and timers forever.
  req.on('close', () => {
    unsubscribe()
    clearInterval(ping)
    clearTimeout(expire)
  })
})

export default router
