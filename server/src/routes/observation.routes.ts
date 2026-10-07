import { Router, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import { AssessmentArchivedError } from '../services/capture-session.service'
import {
  correctTranscript,
  deleteObservation,
  EmptyObservationError,
  getPhotoImage,
  getRecordingAudio,
  NotRetryableError,
  observationChangesSchema,
  ObservationNotFoundError,
  ObservationStateError,
  restoreObservation,
  retryTranscription,
  transcriptCorrectionSchema,
  UnknownLocationError,
  updateObservation,
} from '../services/observation.service'
import { fieldErrors } from './field-errors'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Answers a refused change with its status: 404 unknown, 403 not the
// assessment's assigned engineer, 409 archived or in the wrong state (CP-08).
// Rethrows anything else.
function refuse(error: unknown, res: Response) {
  const status =
    error instanceof ObservationNotFoundError
      ? 404
      : error instanceof NotAssignedError
        ? 403
        : error instanceof AssessmentArchivedError ||
            error instanceof ObservationStateError ||
            error instanceof NotRetryableError
          ? 409
          : null
  if (!status || !(error instanceof Error)) throw error
  res.status(status).json({ error: error.message })
}

// Changes an observation's tags (CP-06) and note (CP-08): JSON with any of
// copeDimension (null to uncategorise), severity, locationId, standard and
// note (null or '' to remove either). 400 lists the first problem with each
// invalid field, as for capture.
router.patch('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = observationChangesSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The observation details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  if (Object.values(parsed.data).every((value) => value === undefined)) {
    res
      .status(400)
      .json({ error: 'Send a category, severity, location, standard or note to change.' })
    return
  }
  try {
    res.json(await updateObservation(req.params.id, parsed.data, res.locals.user!))
  } catch (error: unknown) {
    if (error instanceof UnknownLocationError || error instanceof EmptyObservationError) {
      const field = error instanceof UnknownLocationError ? 'locationId' : 'note'
      res.status(400).json({
        error: 'The observation details are invalid.',
        fields: { [field]: error.message },
      })
      return
    }
    refuse(error, res)
  }
})

// Corrects a finished transcript (CP-08 AC10), keeping Whisper's original.
router.put(
  '/:id/recordings/:recordingId/transcript',
  requirePermission('assessments:edit'),
  async (req, res) => {
    const parsed = transcriptCorrectionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The transcript is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    try {
      res.json(
        await correctTranscript(
          req.params.id,
          req.params.recordingId,
          parsed.data.text,
          res.locals.user!,
        ),
      )
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Deletes an observation (CP-08 AC12), a soft delete. 200 with the
// observation, now carrying who deleted it and when.
router.delete('/:id', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await deleteObservation(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Restores a deleted observation (CP-08 AC14).
router.post('/:id/restore', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await restoreObservation(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
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
      refuse(error, res)
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
      refuse(error, res)
    }
  },
)

// Streams the original photo from S3, the raw evidence (CP-04 AC1, AC2). The
// image under a photo's id never changes, so the browser may keep it.
router.get(
  '/:id/photos/:photoId/image',
  requirePermission('assessments:view'),
  async (req, res) => {
    try {
      const photo = await getPhotoImage(req.params.id, req.params.photoId)
      res.set({
        'Content-Type': photo.contentType,
        'Content-Length': String(photo.size),
        'Cache-Control': 'private, max-age=31536000, immutable',
      })
      photo.stream.pipe(res)
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

export default router
