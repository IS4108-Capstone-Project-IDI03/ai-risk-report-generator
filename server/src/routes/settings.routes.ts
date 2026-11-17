// S-01: the Settings API, mounted at /api/settings. Anyone signed in reads and changes
// their own values; only an admin (`settings:manage`) changes models, QA strictness and defaults.
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  SettingsInputError,
  getSettings,
  saveGlobal,
  saveModelChoice,
  savePersonal,
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

router.patch('/me', async (req, res) => {
  try {
    await savePersonal(res.locals.user!.id, req.body)
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

export default router
