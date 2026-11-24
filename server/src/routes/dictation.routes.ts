// Dictation into an assessment's text fields (CP-27), mounted at
// /api/assessments/:reference/dictation. The recording is the raw request
// body; the answer is `{ text }`, tidied by S5. No session is a 401
// (requireAuth); an assessment the caller cannot open is a 403.
import express, { Router } from 'express'
import {
  DictationError,
  MAX_DICTATION_BYTES,
  transcribeDictation,
} from '../services/dictation.service'

const router = Router({ mergeParams: true })

router.post(
  '/',
  express.raw({ type: 'audio/*', limit: MAX_DICTATION_BYTES }),
  async (req: express.Request<{ reference: string }>, res) => {
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    try {
      const text = await transcribeDictation(
        req.params.reference,
        res.locals.user!,
        audio,
        req.get('Content-Type') ?? '',
      )
      res.json({ text })
    } catch (error) {
      if (!(error instanceof DictationError)) throw error
      res.status(error.status).json({ error: error.message })
    }
  },
)

export default router
