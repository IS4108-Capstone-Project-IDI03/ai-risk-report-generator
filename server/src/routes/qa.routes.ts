// S-01 AC9: stub of the QA check endpoint (EV-05 fills it in).
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { QaNotBuiltError, runQaCheck } from '../services/qa.service'
import { QaSameProviderError } from '../services/settings.service'

const router = Router()

router.post('/check', requirePermission('reports:generate'), async (_req, res) => {
  try {
    await runQaCheck()
  } catch (error) {
    if (error instanceof QaSameProviderError) {
      res.status(409).json({ error: error.message })
      return
    }
    if (error instanceof QaNotBuiltError) {
      res.status(501).json({ error: error.message })
      return
    }
    throw error
  }
})

export default router
