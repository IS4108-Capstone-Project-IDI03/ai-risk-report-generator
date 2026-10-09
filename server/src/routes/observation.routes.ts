import { Router, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import { AssessmentArchivedError } from '../services/capture-session.service'
import {
  addMedia,
  correctTranscript,
  deleteObservation,
  EmptyObservationError,
  getPhotoImage,
  getRecordingAudio,
  NotRetryableError,
  observationChangesSchema,
  ObservationNotFoundError,
  ObservationStateError,
  readPhotos,
  removeMedia,
  restoreMedia,
  restoreObservation,
  retryTranscription,
  transcriptCorrectionSchema,
  UnknownLocationError,
  updateObservation,
} from '../services/observation.service'
import { fieldErrors } from './field-errors'
import { mediaParts, multipartBody, readForm, tooLarge } from './media-form'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Answers a refused change with its status: 404 unknown, 403 not the
// assessment's assigned engineer, 409 archived, in the wrong state, or left
// with nothing captured (CP-08). Rethrows anything else.
function refuse(error: unknown, res: Response) {
  const status =
    error instanceof ObservationNotFoundError
      ? 404
      : error instanceof NotAssignedError
        ? 403
        : error instanceof AssessmentArchivedError ||
            error instanceof ObservationStateError ||
            error instanceof NotRetryableError ||
            error instanceof EmptyObservationError
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

// Adds recordings and photos to a saved observation (CP-08), as a multipart
// form of `recording` and `photo` parts checked as capture checks them. Each
// recording is transcribed; no photo is read until an engineer asks. Needs no
// capture session, only the assessment's assigned engineer.
router.post(
  '/:id/media',
  requirePermission('assessments:edit'),
  multipartBody,
  async (req, res) => {
    const form = await readForm(req)
    if (!form) {
      res.status(400).json({ error: 'Send the recordings and photos as a multipart form.' })
      return
    }
    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    if (!media.recordings.length && !media.photos.length) {
      res.status(400).json({ error: 'Add a recording or a photo to the observation.' })
      return
    }
    try {
      res.json(await addMedia(req.params.id, media.recordings, media.photos, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Removes a recording or photo (CP-08), a soft removal: it stays in S3, is no
// longer evidence, and can be restored. 200 with the observation.
for (const kind of ['recordings', 'photos'] as const) {
  router.delete(`/:id/${kind}/:itemId`, requirePermission('assessments:edit'), async (req, res) => {
    try {
      res.json(await removeMedia(req.params.id, kind, req.params.itemId, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  })
  router.post(
    `/:id/${kind}/:itemId/restore`,
    requirePermission('assessments:edit'),
    async (req, res) => {
      try {
        res.json(await restoreMedia(req.params.id, kind, req.params.itemId, res.locals.user!))
      } catch (error: unknown) {
        refuse(error, res)
      }
    },
  )
}

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

// Reads the observation's photos (CP-05): the first reading, a new one after
// a failure, or after photos were added or removed (CP-08). Saving never reads
// them, so this is the only way a photo reaches the vision model. Open to any risk engineer, as a transcription
// retry is.
router.post('/:id/interpretation', requirePermission('assessments:edit'), async (req, res) => {
  try {
    await readPhotos(req.params.id)
    res.status(202).end()
  } catch (error: unknown) {
    refuse(error, res)
  }
})

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

router.use(tooLarge)

export default router
