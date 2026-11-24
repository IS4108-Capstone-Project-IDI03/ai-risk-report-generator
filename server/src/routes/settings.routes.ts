// S-01: the Settings API, mounted at /api/settings. Anyone signed in reads;
// only an admin (`settings:manage`) changes models and QA strictness.
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  SettingsInputError,
  getSettings,
  saveGlobal,
  saveModelChoice,
  saveSourcePriority,
} from '../services/settings.service'
import {
  addPrivacyWord,
  maskedInReports,
  privacyWordsView,
  removePrivacyWord,
} from '../services/privacy-words.service'

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

// Saves the order sources are ranked by (RT-04).
router.put('/source-priority', requirePermission('settings:manage'), async (req, res) => {
  try {
    await saveSourcePriority(res.locals.user!, req.body?.order)
    res.json(await getSettings(res.locals.user!))
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

// PV-09: the knowledge admin's Always masked and Never masked lists. Admins only, even to read:
// Always masked names are client data (AC6).
router.get('/privacy-words', requirePermission('settings:manage'), async (_req, res) => {
  res.json(await privacyWordsView())
})

// AC10: each word past reports had masked, to spot one masked by mistake.
router.get(
  '/privacy-words/masked-in-reports',
  requirePermission('settings:manage'),
  async (_req, res) => {
    res.json(await maskedInReports())
  },
)

router.delete('/privacy-words/:id', requirePermission('settings:manage'), async (req, res) => {
  try {
    await removePrivacyWord(res.locals.user!, req.params.id)
    res.json({})
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

router.post('/privacy-words', requirePermission('settings:manage'), async (req, res) => {
  try {
    await addPrivacyWord(res.locals.user!, req.body ?? {})
    res.status(201).json({})
  } catch (error) {
    if (!answer(error, res)) throw error
  }
})

export default router
