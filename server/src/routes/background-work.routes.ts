// The gateway's /api/background-work URL (F-11): the caller's own background
// work, for the header's activity popover. Mounted in index.ts under
// requireAuthNoRefresh, since the popover polls it while work runs and polling
// must not keep an idle session alive (F-07). Scoped to the caller's session,
// so no permission is checked; the work is in background-work.service.ts.
import { Router } from 'express'
import { backgroundWorkFor } from '../services/background-work.service'

const router = Router()

router.get('/', async (_req, res) => {
  res.json(await backgroundWorkFor(res.locals.user!))
})

export default router
