import { Router } from 'express'
import { listClients, listClientSites, UnknownClientError } from '../services/client.service'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Every client, for the create form (CP-17 AC1, AC9). Only those who create
// assessments need them.
router.get('/', requirePermission('assessments:edit'), async (_req, res) => {
  res.json(await listClients())
})

// The client's sites, each with its latest visit (AC2, AC3). 404 for an
// unknown client.
router.get('/:id/sites', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await listClientSites(req.params.id))
  } catch (error: unknown) {
    if (error instanceof UnknownClientError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

export default router
