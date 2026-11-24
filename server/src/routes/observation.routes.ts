import { Router, type Response } from 'express'
import { NotAssignedError } from '../services/assessment.service'
import { AssessmentArchivedError } from '../services/capture-session.service'
import {
  addMedia,
  correctTranscript,
  deleteObservation,
  discardDraft,
  EmptyObservationError,
  getObservation,
  getPageImage,
  getPhotoImage,
  getRedactedPhotoImage,
  getRecordingAudio,
  markPhoto,
  MEDIA_KINDS,
  NotRetryableError,
  observationChangesSchema,
  photoRegionSchema,
  ObservationNotFoundError,
  ObservationStateError,
  removeMedia,
  restoreMedia,
  restoreObservation,
  retranscribePage,
  retryPageTranscription,
  retrySuggestion,
  retryTranscription,
  transcriptCorrectionSchema,
  UnknownLocationError,
  updateObservation,
} from '../services/observation.service'
import { fieldErrors } from './field-errors'
import { mediaParts, multipartBody, readForm, tooLarge } from './media-form'
import { sendFile } from './byte-range'
import { requirePermission } from '../middleware/auth.middleware'
import { practiceRecordGate } from '../middleware/practice.middleware'

const router = Router()

// F-12: a practice record is its owner's alone; 404 to anyone else on every route below.
router.param('id', practiceRecordGate('observation'))

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
// copeDimensions (null or [] to uncategorise), severity (null to empty it),
// locationId, standard and note (null or '' to remove either), and `confirm`,
// the suggested fields to keep as they are (CP-24). 400 lists the first problem
// with each invalid field, as for capture.
router.patch('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = observationChangesSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The observation details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  if (Object.values(parsed.data).every((value) => value === undefined)) {
    res.status(400).json({
      error: 'Send a category, severity, location, standard or note to change, or confirm.',
    })
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

// Corrects a handwritten page's finished transcription (CP-20), keeping what
// the model wrote, as a recording's transcript is corrected.
router.put(
  '/:id/pages/:pageId/transcript',
  requirePermission('assessments:edit'),
  async (req, res) => {
    const parsed = transcriptCorrectionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The page’s text is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    try {
      res.json(
        await correctTranscript(
          req.params.id,
          req.params.pageId,
          parsed.data.text,
          res.locals.user!,
          'pages',
        ),
      )
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Adds recordings, photos and handwritten pages to a saved observation (CP-08,
// CP-20), as a multipart form of `recording`, `photo` and `page` parts checked
// as capture checks them. Each recording and page is transcribed, and the
// photos described (CP-24). Needs no capture session, only the assessment's
// assigned engineer.
router.post(
  '/:id/media',
  requirePermission('assessments:edit'),
  multipartBody,
  async (req, res) => {
    const form = await readForm(req)
    if (!form) {
      res.status(400).json({ error: 'Send the recordings, photos and pages as a multipart form.' })
      return
    }
    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    if (!media.recordings.length && !media.photos.length && !media.pages.length) {
      res.status(400).json({ error: 'Add a recording, a photo or a page to the observation.' })
      return
    }
    try {
      res.json(
        await addMedia(
          req.params.id,
          media.recordings,
          media.photos,
          res.locals.user!,
          media.pages,
        ),
      )
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Marks the area of a photo that matters (CP-10): JSON {x, y, w, h}, fractions
// of the photo's width and height. The photo itself is never changed. 200 with
// the observation; DELETE clears the mark.
router.put(
  '/:id/photos/:photoId/region',
  requirePermission('assessments:edit'),
  async (req, res) => {
    const parsed = photoRegionSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0].message, fields: fieldErrors(parsed.error) })
      return
    }
    try {
      res.json(await markPhoto(req.params.id, req.params.photoId, parsed.data, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)
router.delete(
  '/:id/photos/:photoId/region',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      res.json(await markPhoto(req.params.id, req.params.photoId, null, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Removes a recording, photo or handwritten page (CP-08, CP-20), a soft
// removal: it stays in S3, is no longer evidence, and can be restored. 200
// with the observation. On a draft observation a recording goes for good,
// file and all (CP-24).
for (const kind of MEDIA_KINDS) {
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

// Starts a new transcription attempt for a failed recording (CP-03 AC7), for the
// assessment's assigned engineer (RV-11: an admin holds assessments:edit too).
router.post(
  '/:id/recordings/:recordingId/transcription/retry',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      await retryTranscription(req.params.id, req.params.recordingId, res.locals.user!)
      res.status(202).end()
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Starts a new transcription attempt for a failed handwritten page (CP-19 AC11),
// for the assessment's assigned engineer, as a recording's retry is.
router.post(
  '/:id/pages/:pageId/transcription/retry',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      await retryPageTranscription(req.params.id, req.params.pageId, res.locals.user!)
      res.status(202).end()
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Transcribes a page again although its last transcription succeeded (CP-20):
// the assessment's assigned engineer only, as it replaces evidence. 200 with
// the observation, the page Transcribing.
router.post(
  '/:id/pages/:pageId/retranscribe',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      res.json(await retranscribePage(req.params.id, req.params.pageId, res.locals.user!))
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Tries suggesting the category and severity again after a failure (CP-24
// AC13). 202 with the observation, now Reading. As PATCH: the assigned engineer.
router.post('/:id/suggestion/retry', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.status(202).json(await retrySuggestion(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// One observation (CP-24): the open page re-reads it when the `observations`
// event arrives. A draft observation only for its assessment's assigned engineer.
router.get('/:id', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await getObservation(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuse(error, res)
  }
})

// Discards a draft observation and its recordings' files (CP-24 AC3), when
// New Observation is left without saving. 204; 404 if it is not a draft.
router.delete('/:id/draft', requirePermission('assessments:edit'), async (req, res) => {
  try {
    await discardDraft(req.params.id, res.locals.user!)
    res.status(204).end()
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
      await sendFile(req, res, audio)
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
      await sendFile(req, res, photo, { 'Cache-Control': 'private, max-age=31536000, immutable' })
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Streams a photo as the model last saw it with protection on: its faces
// blurred (PV-04). Reading the photo again replaces it, so the browser checks
// before reusing it.
router.get(
  '/:id/photos/:photoId/redacted',
  requirePermission('assessments:view'),
  async (req, res) => {
    try {
      const photo = await getRedactedPhotoImage(req.params.id, req.params.photoId)
      res.set({
        'Content-Type': 'image/jpeg',
        'Content-Length': String(photo.size),
        'Cache-Control': 'private, no-cache',
      })
      photo.stream.pipe(res)
    } catch (error: unknown) {
      refuse(error, res)
    }
  },
)

// Streams the original photo of a handwritten page from S3, the raw evidence
// (CP-19 AC1). Like a photo, it never changes, so the browser may keep it.
router.get('/:id/pages/:pageId/image', requirePermission('assessments:view'), async (req, res) => {
  try {
    const page = await getPageImage(req.params.id, req.params.pageId)
    res.set({
      'Content-Type': page.contentType,
      'Content-Length': String(page.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    page.stream.pipe(res)
  } catch (error: unknown) {
    refuse(error, res)
  }
})

router.use(tooLarge)

export default router
