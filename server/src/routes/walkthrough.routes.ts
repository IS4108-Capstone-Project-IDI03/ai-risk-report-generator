// F-12: the walkthroughs' own routes, all scoped to the caller's own account (no permission).
// Mounted at /api/walkthroughs in index.ts. Calls practice.service.ts and
// walkthrough-check.service.ts. The walkthrough record itself is saved through
// PATCH /api/settings/me and read with the signed-in user (auth.routes.ts).
import { Router } from 'express'
import { removePractice, setUpPractice } from '../services/practice/practice.service'
import { tryItReady } from '../services/walkthrough-check.service'

const router = Router()

// "Reset" and "Set it up again" in Settings: the old practice assessment is hidden, never
// deleted, and a fresh one is made from the template.
router.post('/practice', async (_req, res) => {
  res.status(201).json({ reference: await setUpPractice(res.locals.user!) })
})

// "Remove" in Settings: hides it for good.
router.delete('/practice', async (_req, res) => {
  await removePractice(res.locals.user!)
  res.status(204).end()
})

// Asked before a try-it is offered or started: are the services it needs working?
router.get('/check', async (req, res) => {
  const walkthrough = typeof req.query.for === 'string' ? req.query.for : ''
  const ok = await tryItReady(walkthrough, res.locals.user!)
  if (ok === null) {
    res.status(404).json({ error: 'That walkthrough has no try-it.' })
    return
  }
  res.json({ ok })
})

export default router
