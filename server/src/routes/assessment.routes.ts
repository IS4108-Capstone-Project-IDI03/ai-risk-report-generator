import { Router, type Response } from 'express'
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
  listObservations,
  newObservationSchema,
  NoActiveSessionError,
  saveObservation,
  UnknownLocationError,
} from '../services/observation.service'
import { acceptOfi, draftOfis, listOfis, OfiNotFoundError } from '../services/ofi.service'
import { RagServiceError } from '../services/rag.service'
import {
  bulkAccept,
  ConcurrentDecisionError,
  decideFinding,
  decideReplacement,
  draftChoiceSchema,
  findingEditSchema,
  FindingNotFoundError,
  FindingStateError,
  NotDraftedError,
  regenerateSchema,
  regenerateSection,
  ReplacementNotFoundError,
  ReplacementPendingError,
  StaleDraftError,
} from '../services/review-decision.service'
import { getReviewWorkspace } from '../services/review.service'
import {
  draftSection,
  InsufficientEvidenceError,
  listSections,
  TranscriptionInProgressError,
  UnknownSectionError,
} from '../services/section.service'
import { fieldErrors } from './field-errors'
import { mediaParts, multipartBody, readForm, tooLarge } from './media-form'
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

// Saves one observation (CP-02, CP-03, CP-04) as a multipart form: a `details`
// part holding the JSON fields (see newObservationSchema), a `recording` part
// per audio file and a `photo` part per JPG or PNG, checked by mediaParts. It
// needs at least one of a note, a recording or a photo. 400 lists the first
// problem with each invalid field, as for assessments.
router.post(
  '/:reference/observations',
  requirePermission('assessments:edit'),
  multipartBody,
  async (req, res) => {
    const form = await readForm(req)
    if (!form) {
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

    const media = await mediaParts(form)
    if ('error' in media) {
      res.status(media.status).json({ error: media.error })
      return
    }
    if (!parsed.data.note && media.recordings.length === 0 && media.photos.length === 0) {
      res.status(400).json({ error: 'Add a note, a recording or a photo to the observation.' })
      return
    }
    try {
      res
        .status(201)
        .json(
          await saveObservation(
            req.params.reference,
            parsed.data,
            media.recordings,
            res.locals.user!,
            media.photos,
          ),
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

// The assessment's observations, newest first. Deleted ones are left out
// unless `?include=deleted` asks for them too (CP-08 AC14).
router.get('/:reference/observations', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(
      await listObservations(req.params.reference, {
        includeDeleted: req.query.include === 'deleted',
      }),
    )
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

// The review workspace (RV-01) is available to anyone who can view the
// assessment. Its decisions (RV-02) are the routes below, for the assigned
// engineer.
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

// What every review decision (RV-02) answers for each failure: 404 (unknown
// assessment, section, finding or waiting replacement), 403 for anyone but
// the assigned engineer, 409 when the decision no longer applies (archived,
// not drafted, the saved draft changed since it was opened, a rejected
// finding, a decision saved at the same moment, a replacement already
// waiting, a transcription in progress), 422 when regenerating lacks
// evidence, 503 when S4 fails (not 502, which the client reads as the
// gateway being down).
function reviewFailure(error: unknown, res: Response) {
  if (
    error instanceof AssessmentNotFoundError ||
    error instanceof UnknownSectionError ||
    error instanceof FindingNotFoundError ||
    error instanceof ReplacementNotFoundError
  ) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof NotAssignedError) {
    res.status(403).json({ error: error.message })
  } else if (
    error instanceof AssessmentArchivedError ||
    error instanceof NotDraftedError ||
    error instanceof StaleDraftError ||
    error instanceof FindingStateError ||
    error instanceof ConcurrentDecisionError ||
    error instanceof ReplacementPendingError ||
    error instanceof TranscriptionInProgressError
  ) {
    res.status(409).json({ error: error.message })
  } else if (error instanceof InsufficientEvidenceError) {
    res.status(422).json({ error: error.message, found: error.found, needed: error.needed })
  } else if (error instanceof RagServiceError) {
    res.status(503).json({ error: error.message })
  } else {
    throw error
  }
}

// Accepts (AC1), rejects (AC5) or restores one finding of a section's saved
// draft, named by `draftId`. 200 with the review workspace as it now stands.
for (const action of ['accept', 'reject', 'restore'] as const) {
  router.post(
    `/:reference/sections/:sectionId/findings/:finding/${action}`,
    requirePermission('reports:generate'),
    async (req, res) => {
      const parsed = draftChoiceSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Say which draft the decision is about.' })
        return
      }
      const { reference, sectionId, finding } = req.params
      try {
        const user = res.locals.user!
        await decideFinding(reference, sectionId, finding, parsed.data.draftId, { action }, user)
        res.json(await getReviewWorkspace(reference))
      } catch (error: unknown) {
        reviewFailure(error, res)
      }
    },
  )
}

// Saves the engineer's wording of one finding (AC2), recording the text
// before and after with who changed it when (AC3, AC4). 400 names the field.
router.put(
  '/:reference/sections/:sectionId/findings/:finding',
  requirePermission('reports:generate'),
  async (req, res) => {
    const parsed = findingEditSchema.safeParse(req.body)
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The edited finding is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    const { reference, sectionId, finding } = req.params
    try {
      await decideFinding(
        reference,
        sectionId,
        finding,
        parsed.data.draftId,
        { action: 'edit', text: parsed.data.text },
        res.locals.user!,
      )
      res.json(await getReviewWorkspace(reference))
    } catch (error: unknown) {
      reviewFailure(error, res)
    }
  },
)

// Bulk accept (AC7, AC8): every pending finding of the section's saved draft.
router.post(
  '/:reference/sections/:sectionId/bulk-accept',
  requirePermission('reports:generate'),
  async (req, res) => {
    const parsed = draftChoiceSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Say which draft the decision is about.' })
      return
    }
    const { reference, sectionId } = req.params
    try {
      await bulkAccept(reference, sectionId, parsed.data.draftId, res.locals.user!)
      res.json(await getReviewWorkspace(reference))
    } catch (error: unknown) {
      reviewFailure(error, res)
    }
  },
)

// Regenerates one section as a replacement draft (AC10), with an optional
// instruction saying what to change: 201 with the review workspace, in which
// the section's `replacement` waits beside its saved draft.
router.post(
  '/:reference/sections/:sectionId/regenerate',
  requirePermission('reports:generate'),
  async (req, res) => {
    const parsed = regenerateSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'The instruction is invalid.', fields: fieldErrors(parsed.error) })
      return
    }
    const { reference, sectionId } = req.params
    try {
      await regenerateSection(reference, sectionId, parsed.data.instruction, res.locals.user!)
      res.status(201).json(await getReviewWorkspace(reference))
    } catch (error: unknown) {
      reviewFailure(error, res)
    }
  },
)

// Accepts the waiting replacement as the section's saved content (AC11), or
// discards it, leaving the saved draft as it was (AC12). 200 with the
// review workspace.
for (const [action, accept] of [
  ['accept', true],
  ['discard', false],
] as const) {
  router.post(
    `/:reference/sections/:sectionId/replacement/${action}`,
    requirePermission('reports:generate'),
    async (req, res) => {
      const parsed = draftChoiceSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Say which replacement draft the decision is about.' })
        return
      }
      const { reference, sectionId } = req.params
      try {
        await decideReplacement(reference, sectionId, parsed.data.draftId, accept, res.locals.user!)
        res.json(await getReviewWorkspace(reference))
      } catch (error: unknown) {
        reviewFailure(error, res)
      }
    },
  )
}

router.use(tooLarge)

// Section 3 Opportunities for Improvement (GN-05): suggestions and the
// accepted OFIs in report order. Read-only, so a knowledge admin can open it.
router.get('/:reference/ofis', requirePermission('assessments:view'), async (req, res) => {
  try {
    res.json(await listOfis(req.params.reference))
  } catch (error: unknown) {
    if (error instanceof AssessmentNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// What both OFI writes answer for each failure: 404, 403 for anyone but the
// assigned engineer, 409 while a transcription is unfinished or once archived,
// 503 when S4 fails (not 502, which the client reads as the gateway being down).
function ofiFailure(error: unknown, res: Response) {
  if (error instanceof AssessmentNotFoundError || error instanceof OfiNotFoundError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof NotAssignedError) {
    res.status(403).json({ error: error.message })
  } else if (
    error instanceof TranscriptionInProgressError ||
    error instanceof AssessmentArchivedError
  ) {
    res.status(409).json({ error: error.message })
  } else if (error instanceof RagServiceError) {
    res.status(503).json({ error: error.message })
  } else {
    throw error
  }
}

// Drafts OFI suggestions from the assessment's observations, replacing the
// unaccepted ones: 201 with { suggestions, accepted }.
router.post('/:reference/ofis/draft', requirePermission('reports:generate'), async (req, res) => {
  try {
    res.status(201).json(await draftOfis(req.params.reference, res.locals.user!))
  } catch (error: unknown) {
    ofiFailure(error, res)
  }
})

// Accepts one suggestion into the report (AC4): 200 with { suggestions, accepted }.
router.post(
  '/:reference/ofis/:id/accept',
  requirePermission('reports:generate'),
  async (req, res) => {
    try {
      res.json(await acceptOfi(req.params.reference, req.params.id, res.locals.user!))
    } catch (error: unknown) {
      ofiFailure(error, res)
    }
  },
)

export default router
