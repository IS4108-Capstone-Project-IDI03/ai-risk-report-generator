import express, { Router, type ErrorRequestHandler } from 'express'
import {
  createAssessment,
  listAssessments,
  newAssessmentSchema,
} from '../services/assessment.service'
import { AssessmentNotFoundError, startCaptureSession } from '../services/capture-session.service'
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
import { fieldErrors } from './field-errors'

const router = Router()

// The work list (RV-10). Filtering and search happen in the client for now.
router.get('/', async (_req, res) => {
  res.json(await listAssessments())
})

// Creates an assessment (and its site). 400 lists the first problem with each
// invalid field.
router.post('/', async (req, res) => {
  const parsed = newAssessmentSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The assessment details are invalid.', fields: fieldErrors(parsed.error) })
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

// The places on site the engineer records observations in.
router.get('/:reference/locations', async (req, res) => {
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
router.post('/:reference/locations', async (req, res) => {
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
router.delete('/:reference/locations/:id', async (req, res) => {
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
})

// Saves one observation (CP-02, CP-03) as a multipart form: a `details` part
// holding the JSON fields (see newObservationSchema) and a `recording` part
// per audio file. It needs a note, a recording or both. 400 lists the first
// problem with each invalid field, as for assessments. Each recording may be
// up to 25 MB, the Whisper upload limit.
// ponytail: the whole form is buffered in memory; stream it to S3 if uploads
// grow past a few recordings.
router.post(
  '/:reference/observations',
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
      res.status(201).json(await saveObservation(req.params.reference, parsed.data, recordings))
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

// express.raw rejects a body over the limit before the handler runs.
const tooLarge: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type !== 'entity.too.large') return next(error)
  res
    .status(413)
    .json({ error: 'The recordings are larger than 100 MB in total. Save fewer at once.' })
}
router.use(tooLarge)

export default router
