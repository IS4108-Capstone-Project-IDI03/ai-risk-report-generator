import { Router } from 'express'
import {
  getObservationAudio,
  NotRetryableError,
  ObservationNotFoundError,
  retryTranscription,
} from '../services/observation.service'

const router = Router()

// Starts a new transcription attempt for a failed voice observation (CP-03 AC7).
router.post('/:id/transcription/retry', async (req, res) => {
  try {
    res.status(202).json(await retryTranscription(req.params.id))
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
})

// Streams the original recording from S3, the raw evidence (CP-03 AC1).
router.get('/:id/audio', async (req, res) => {
  try {
    const audio = await getObservationAudio(req.params.id)
    res.set({ 'Content-Type': audio.contentType, 'Content-Length': String(audio.size) })
    audio.stream.pipe(res)
  } catch (error: unknown) {
    if (error instanceof ObservationNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

export default router
