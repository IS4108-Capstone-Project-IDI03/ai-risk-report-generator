import { Router } from 'express'
import {
  getRecordingAudio,
  NotRetryableError,
  ObservationNotFoundError,
  retryTranscription,
} from '../services/observation.service'

const router = Router()

// Starts a new transcription attempt for a failed recording (CP-03 AC7).
router.post('/:id/recordings/:recordingId/transcription/retry', async (req, res) => {
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
})

// Streams the original recording from S3, the raw evidence (CP-03 AC1).
router.get('/:id/recordings/:recordingId/audio', async (req, res) => {
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
})

export default router
