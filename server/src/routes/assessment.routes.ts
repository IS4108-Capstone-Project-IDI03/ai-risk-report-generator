import express, { Router, type ErrorRequestHandler } from 'express'
import {
  createAssessment,
  listAssessments,
  newAssessmentSchema,
} from '../services/assessment.service'
import { AssessmentNotFoundError, startCaptureSession } from '../services/capture-session.service'
import {
  audioExtension,
  isCopeDimension,
  isSeverity,
  listObservations,
  newTextObservationSchema,
  NoActiveSessionError,
  saveTextObservation,
  saveVoiceObservation,
} from '../services/observation.service'

const router = Router()

// The work list (RV-10). Filtering and search happen in the client for now.
router.get('/', async (_req, res) => {
  res.json(await listAssessments())
})

// Creates an assessment (and its site). 400 lists the first problem with each
// invalid field, keyed by path, e.g. { "site.name": "Site name is required." }.
router.post('/', async (req, res) => {
  const parsed = newAssessmentSchema.safeParse(req.body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.')
      fields[path] ??= issue.message
    }
    res.status(400).json({ error: 'The assessment details are invalid.', fields })
    return
  }
  res.status(201).json(await createAssessment(parsed.data))
})

// Opens capture for an assessment: 201 when a new session was started, 200
// when the assessment's active session was returned.
router.post('/:reference/capture-session', async (req, res) => {
  try {
    const { created, session, assessment } = await startCaptureSession(req.params.reference)
    res.status(created ? 201 : 200).json({ session, assessment })
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// Records a voice observation (CP-03). The body is the audio itself, sent with
// its own Content-Type; 25 MB is the Whisper upload limit. X-COPE-Dimension is
// the category the engineer picked and X-Severity how serious it is.
// ponytail: the engineer's name comes from a header until sign-in (F-04)
// identifies them on the server.
router.post(
  '/:reference/observations/voice',
  express.raw({ type: 'audio/*', limit: '25mb' }),
  async (req, res) => {
    const contentType = req.get('Content-Type') ?? ''
    const engineer = req.get('X-Engineer')?.trim()
    const copeDimension = req.get('X-COPE-Dimension')?.trim()
    const severity = req.get('X-Severity')?.trim()
    if (!audioExtension(contentType)) {
      res.status(415).json({
        error: 'This audio format is not supported. Use WebM, Ogg, MP4, M4A, MP3, WAV or FLAC.',
      })
      return
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'The recording is empty.' })
      return
    }
    if (!engineer) {
      res.status(400).json({ error: 'The engineer recording the observation is missing.' })
      return
    }
    if (!isCopeDimension(copeDimension)) {
      res.status(400).json({
        error: 'Choose a COPE category: Construction, Occupancy, Protection or Exposure.',
      })
      return
    }
    if (!isSeverity(severity)) {
      res.status(400).json({ error: 'Choose a severity: critical, high, moderate or low.' })
      return
    }
    // Optional, and in the query rather than headers because their values are
    // not plain ASCII (e.g. "NFPA 25 – 2026 Edition", "Bay 3 — north aisle").
    const optional = (name: 'standard' | 'area') =>
      typeof req.query[name] === 'string' ? req.query[name].trim() || undefined : undefined
    const standard = optional('standard')
    const area = optional('area')
    if ((standard?.length ?? 0) > 100 || (area?.length ?? 0) > 100) {
      res.status(400).json({ error: 'The standard and location must be 100 characters or fewer.' })
      return
    }
    try {
      res.status(201).json(
        await saveVoiceObservation(req.params.reference, req.body, contentType, {
          engineer,
          copeDimension,
          severity,
          area,
          standard,
        }),
      )
    } catch (error: unknown) {
      if (error instanceof AssessmentNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof NoActiveSessionError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

router.get('/:reference/observations', async (req, res) => {
  try {
    res.json(await listObservations(req.params.reference))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// Records a text note (CP-02) in the assessment's active capture session,
// exactly as written. A null copeDimension leaves it uncategorised. 400 lists
// the first problem with each invalid field, as for assessments.
router.post('/:reference/observations/text', async (req, res) => {
  const parsed = newTextObservationSchema.safeParse(req.body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.')
      fields[path] ??= issue.message
    }
    res.status(400).json({ error: 'The observation details are invalid.', fields })
    return
  }
  try {
    res.status(201).json(await saveTextObservation(req.params.reference, parsed.data))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof NoActiveSessionError) {
      res.status(409).json({ error: error.message })
      return
    }
    throw error
  }
})

// express.raw rejects a body over the limit before the handler runs.
const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res.status(413).json({ error: 'The recording is larger than 25 MB. Upload a shorter one.' })
}
router.use(tooLarge)

export default router
