import { Router } from 'express'
import {
  getRecordingAudio,
  NotRetryableError,
  ObservationNotFoundError,
  observationTagsSchema,
  retryTranscription,
  UnknownLocationError,
  updateObservationTags,
} from '../services/observation.service'
import { fieldErrors } from './field-errors'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Changes an observation's tags (CP-06): JSON with any of copeDimension (null
// to uncategorise), severity, locationId and standard (null or '' to remove).
// 400 lists the first problem with each invalid field, as for capture.
router.patch('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = observationTagsSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The observation tags are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  if (Object.values(parsed.data).every((value) => value === undefined)) {
    res.status(400).json({ error: 'Send a category, severity, location or standard to change.' })
    return
  }
  try {
    res.json(await updateObservationTags(req.params.id, parsed.data))
  } catch (error: unknown) {
    if (error instanceof ObservationNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof UnknownLocationError) {
      res.status(400).json({
        error: 'The observation tags are invalid.',
        fields: { locationId: error.message },
      })
      return
    }
    throw error
  }
})

// Starts a new transcription attempt for a failed recording (CP-03 AC7).
router.post(
  '/:id/recordings/:recordingId/transcription/retry',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      await retryTranscription(req.params.id, req.params.recordingId)
      res.status(202).end()
    } catch (error: unknown) {
      if (error instanceof ObservationNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof NotRetryableError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

// Streams the original recording from S3, the raw evidence (CP-03 AC1).
router.get(
  '/:id/recordings/:recordingId/audio',
  requirePermission('assessments:view'),
  async (req, res) => {
    try {
      const audio = await getRecordingAudio(req.params.id, req.params.recordingId)
      res.set({ 'Content-Type': audio.contentType, 'Content-Length': String(audio.size) })
      audio.stream.pipe(res)
    } catch (error: unknown) {
      if (error instanceof ObservationNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

export default router
