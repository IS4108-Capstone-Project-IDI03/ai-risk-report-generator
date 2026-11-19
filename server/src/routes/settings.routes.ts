// S-01: the Settings API, mounted at /api/settings. Anyone signed in reads;
// only an admin (`settings:manage`) changes models and QA strictness.
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  SettingsInputError,
  getSettings,
  saveGlobal,
  saveModelChoice,
  savePersonal,
  saveSourcePriority,
} from '../services/settings.service'

const router = Router()

// Turns a bad request into its 400 or 404, and lets anything else reach the error handler.
function answer(error: unknown, res: import('express').Response): boolean {
  if (error instanceof SettingsInputError) {
    res.status(error.status).json({ error: error.message })
    return true
  }
  return false
}

router.get('/', async (_req, res) => {
  res.json(await getSettings(res.locals.user!))
})

router.put('/models/:task', requirePermission('settings:manage'), async (req, res) => {
  try {
    await saveModelChoice(res.locals.user!, req.params.task, req.body?.option)
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

router.patch('/global', requirePermission('settings:manage'), async (req, res) => {
  try {
    await saveGlobal(res.locals.user!, req.body ?? {})
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

// Saves the signed-in engineer's own note codes and glossary (CP-35). No permission beyond
// signing in: it only ever writes the caller's own document.
router.patch('/me', async (req, res) => {
  try {
    await savePersonal(res.locals.user!.id, req.body ?? {})
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

// Saves the order sources are ranked by (RT-04).
router.put('/source-priority', requirePermission('settings:manage'), async (req, res) => {
  try {
    await saveSourcePriority(res.locals.user!, req.body?.order)
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

export default router
