// The weather at an assessment's site (CP-62), mounted at /api/assessments/:reference/weather.
// Anyone who can view the assessment may read it. The gateway alone calls the weather provider,
// with the server's key (site-weather.service.ts), so the key never reaches the browser (AC5).
// Mounted with requireAuthNoRefresh: an open panel refreshes itself every 10 minutes, which must
// not keep an idle session alive (F-07).
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { AssessmentNotFoundError } from '../services/capture-session.service'
import { siteWeather } from '../services/site-weather.service'

const router = Router({ mergeParams: true })

type Params = { reference: string }

// 200 with `{ status: 'ok' | 'no-address' | 'unconfigured' | 'unavailable', ... }`, 404 for an
// unknown assessment. Never cached by the browser: the gateway keeps readings for 10 minutes.
router.get('/', requirePermission('assessments:view'), async (req, res) => {
  try {
    const weather = await siteWeather((req.params as Params).reference)
    res.set('Cache-Control', 'no-store').json(weather)
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

export default router
