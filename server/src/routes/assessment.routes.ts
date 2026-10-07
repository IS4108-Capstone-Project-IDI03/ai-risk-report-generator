import express, { Router, type ErrorRequestHandler } from 'express'
import {
  archiveAssessment,
  assessmentDetailsSchema,
  createAssessment,
  InvalidEngineersError,
  listAssignableEngineers,
  listAssessments,
  newAssessmentSchema,
  NotArchivedError,
  NotAssignedError,
  restoreAssessment,
  updateAssessment,
} from '../services/assessment.service'
import {
  AssessmentArchivedError,
  AssessmentNotFoundError,
  startCaptureSession,
} from '../services/capture-session.service'
import {
  addLocation,
  DuplicateLocationError,
  listLocations,
  LocationInUseError,
  LocationNotFoundError,
  newLocationSchema,
  removeLocation,
} from '../services/location.service'
import {
  audioExtension,
  listObservations,
  newObservationSchema,
  NoActiveSessionError,
  saveObservation,
  UnknownLocationError,
} from '../services/observation.service'
import { RagServiceError } from '../services/rag.service'
import { getReviewWorkspace } from '../services/review.service'
import {
  draftSection,
  InsufficientEvidenceError,
  listSections,
  TranscriptionInProgressError,
  UnknownSectionError,
} from '../services/section.service'
import { fieldErrors } from './field-errors'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// The work list (RV-10). Filtering and search happen in the client for now.
router.get('/', requirePermission('assessments:view'), async (_req, res) => {
  res.json(await listAssessments(res.locals.user!))
})

router.get('/engineers', requirePermission('assessments:edit'), async (_req, res) => {
  res.json(await listAssignableEngineers())
})

// Creates an assessment (and its site). 400 lists the first problem with each
// invalid field.
router.post('/', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = newAssessmentSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The assessment details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    res.status(201).json(await createAssessment(parsed.data))
  } catch (error) {
    if (error instanceof InvalidEngineersError) {
      res.status(400).json({ error: error.message, fields: { engineerId: error.message } })
      return
    }
    throw error
  }
})

// Opens capture for an assessment: 201 when a new session was started, 200
// when the assessment's active session was returned.
router.post(
  '/:reference/capture-session',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      const { created, session, assessment } = await startCaptureSession(req.params.reference)
      res.status(created ? 201 : 200).json({ session, assessment })
    } catch (error: unknown) {
      if (error instanceof AssessmentNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof AssessmentArchivedError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

// Corrects an assessment's details (RV-10 AC10): 204 when saved, 400 naming
// each invalid field (AC11), 403 for anyone but its assigned engineer, 409
// once it is archived.
router.put('/:reference', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = assessmentDetailsSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The assessment details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await updateAssessment(req.params.reference, parsed.data, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof NotAssignedError) {
      res.status(403).json({ error: error.message })
      return
    }
    if (error instanceof AssessmentArchivedError) {
      res.status(409).json({ error: error.message })
      return
    }
    throw error
  }
})

// Archives (RV-10 AC8) or restores (AC9) an assessment: 204 when done, 403
// for anyone but its assigned engineer, 409 when it is already in that state.
for (const [action, change] of [
  ['archive', archiveAssessment],
  ['restore', restoreAssessment],
] as const) {
  router.post(`/:reference/${action}`, requirePermission('assessments:edit'), async (req, res) => {
    try {
      await change(req.params.reference, res.locals.user!)
      res.status(204).end()
    } catch (error: unknown) {
      if (error instanceof AssessmentNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof NotAssignedError) {
        res.status(403).json({ error: error.message })
        return
      }
      if (error instanceof AssessmentArchivedError || error instanceof NotArchivedError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  })
}

// The places on site the engineer records observations in.
router.get('/:reference/locations', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await listLocations(req.params.reference))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// Adds a location. 409 when the same name and floor is already listed.
router.post('/:reference/locations', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = newLocationSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The location details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    res.status(201).json(await addLocation(req.params.reference, parsed.data))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof DuplicateLocationError) {
      res.status(409).json({ error: error.message, fields: { name: error.message } })
      return
    }
    throw error
  }
})

// Removes a location with no observations: 204, 404, or 409 while it has some.
router.delete(
  '/:reference/locations/:id',
  requirePermission('assessments:edit'),
  async (req, res) => {
    try {
      await removeLocation(req.params.reference, req.params.id)
      res.status(204).end()
    } catch (error: unknown) {
      if (error instanceof AssessmentNotFoundError || error instanceof LocationNotFoundError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof LocationInUseError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

// Saves one observation (CP-02, CP-03) as a multipart form: a `details` part
// holding the JSON fields (see newObservationSchema) and a `recording` part
// per audio file. It needs a note, a recording or both. 400 lists the first
// problem with each invalid field, as for assessments. Each recording may be
// up to 25 MB, the Whisper upload limit.
// ponytail: the whole form is buffered in memory; stream it to S3 if uploads
// grow past a few recordings.
router.post(
  '/:reference/observations',
  requirePermission('assessments:edit'),
  express.raw({ type: 'multipart/form-data', limit: '100mb' }),
  async (req, res) => {
    let form: FormData
    try {
      form = await new Response(req.body, {
        headers: { 'Content-Type': req.get('Content-Type') ?? '' },
      }).formData()
    } catch {
      res.status(400).json({ error: 'Send the observation as a multipart form.' })
      return
    }
    let details: unknown
    try {
      details = JSON.parse(String(form.get('details')))
    } catch {
      details = undefined
    }
    const parsed = newObservationSchema.safeParse(details)
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The observation details are invalid.', fields: fieldErrors(parsed.error) })
      return
    }

    const files = form.getAll('recording').filter((part) => part instanceof File)
    if (files.some((file) => !audioExtension(file.type))) {
      res.status(415).json({
        error: 'This audio format is not supported. Use WebM, Ogg, MP4, M4A, MP3, WAV or FLAC.',
      })
      return
    }
    if (files.some((file) => file.size > 25 * 1024 * 1024)) {
      res.status(413).json({ error: 'A recording is larger than 25 MB. Upload a shorter one.' })
      return
    }
    if (files.some((file) => file.size === 0)) {
      res.status(400).json({ error: 'A recording is empty.' })
      return
    }
    if (!parsed.data.note && files.length === 0) {
      res.status(400).json({ error: 'Add a note or a recording to the observation.' })
      return
    }
    const recordings = await Promise.all(
      files.map(async (file, i) => ({
        name: file.name || `Recording ${i + 1}`,
        audio: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
      })),
    )
    try {
      res
        .status(201)
        .json(
          await saveObservation(req.params.reference, parsed.data, recordings, res.locals.user!),
        )
    } catch (error: unknown) {
      if (error instanceof UnknownLocationError) {
        res.status(400).json({
          error: 'The observation details are invalid.',
          fields: { locationId: error.message },
        })
        return
      }
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

router.get('/:reference/observations', requirePermission('assessments:view'), async (req, res) => {
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

// Sections 7-12 of the report, each with its usable evidence count and newest
// draft (GN-01).
router.get('/:reference/sections', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await listSections(req.params.reference))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof RagServiceError) {
      res.status(503).json({ error: error.message })
      return
    }
    throw error
  }
})

// The review workspace (RV-01) is read-only and available to anyone who can
// view the assessment.
router.get('/:reference/review', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await getReviewWorkspace(req.params.reference))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof RagServiceError) {
      res.status(503).json({ error: error.message })
      return
    }
    throw error
  }
})

// Drafts one section from the assessment's observations and saves it (GN-01):
// 201 with the draft, 403 for anyone but the assigned engineer, 404, 409 while
// a transcription is unfinished or once archived, 422 when the
// section lacks evidence, 503 when the drafting service fails (not 502, which
// the client reads as the gateway itself being down).
router.post(
  '/:reference/sections/:sectionId/draft',
  requirePermission('reports:generate'),
  async (req, res) => {
    try {
      res
        .status(201)
        .json(await draftSection(req.params.reference, req.params.sectionId, res.locals.user!))
    } catch (error: unknown) {
      if (error instanceof AssessmentNotFoundError || error instanceof UnknownSectionError) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error instanceof NotAssignedError) {
        res.status(403).json({ error: error.message })
        return
      }
      if (
        error instanceof TranscriptionInProgressError ||
        error instanceof AssessmentArchivedError
      ) {
        res.status(409).json({ error: error.message })
        return
      }
      if (error instanceof InsufficientEvidenceError) {
        res.status(422).json({ error: error.message, found: error.found, needed: error.needed })
        return
      }
      if (error instanceof RagServiceError) {
        res.status(503).json({ error: error.message })
        return
      }
      throw error
    }
  },
)

// express.raw rejects a body over the limit before the handler runs.
const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res
    .status(413)
    .json({ error: 'The recordings are larger than 100 MB in total. Save fewer at once.' })
}
router.use(tooLarge)

export default router
