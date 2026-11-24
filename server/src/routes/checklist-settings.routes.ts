// CP-37: the admin editor's API for fixed checklist items, mounted at /api/settings/checklist
// (before /api/settings in index.ts). Knowledge admins only. Calls checklist-fixed.service.ts.
import { Router, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  addFixedItem,
  editFixedItem,
  listFixedItems,
  setFixedItemRemoved,
} from '../services/checklist-fixed.service'
import { SettingsInputError } from '../services/settings.service'

const router = Router()
router.use(requirePermission('knowledge:manage'))

// Runs a handler and turns a SettingsInputError into its 400 or 404.
const run = (res: Response, work: () => Promise<unknown>, status = 200) =>
  work()
    .then((body) => res.status(status).json(body))
    .catch((error: unknown) => {
      if (!(error instanceof SettingsInputError)) throw error
      res.status(error.status).json({ error: error.message })
    })

router.get('/', (_req, res) => run(res, listFixedItems))
router.post('/', (req, res) => run(res, () => addFixedItem(req.body), 201))
router.patch('/:id', (req, res) => run(res, () => editFixedItem(req.params.id, req.body)))
router.delete('/:id', (req, res) =>
  run(res, () => setFixedItemRemoved(req.params.id, true, res.locals.user!)),
)
router.post('/:id/restore', (req, res) =>
  run(res, () => setFixedItemRemoved(req.params.id, false, res.locals.user!)),
)

export default router
