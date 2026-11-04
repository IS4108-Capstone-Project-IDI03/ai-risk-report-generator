// The client intake API (CP-23), mounted at /api/client-intakes: add a
// client's documents, read them into the New assessment form, discard them, or
// create the records from the checked form. Called by the client's
// assessments feature. Calls only services. Every route needs assessments:edit,
// and an intake answers only the engineer who started it (404 for others).
import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { AssessmentFieldsError, newAssessmentsSchema } from '../services/assessment-batch.service'
import { createFromIntake, intakeDocumentsSchema } from '../services/client-intake-create.service'
import {
  discardIntake,
  IntakeError,
  PASTED_TEXT_LIMIT,
  readIntake,
  startIntake,
} from '../services/client-intake.service'
import { IngestionUnavailableError } from '../services/ingestion.service'
import { RagServiceError } from '../services/rag.service'
import { fieldErrors } from './field-errors'
import { documentFiles, documentsTooLarge, multipartBody, readForm } from './media-form'

const router = Router()
const edit = requirePermission('assessments:edit')

// Answers a refused request with its status. 503 when masking (AC22) or
// ingestion is unavailable, 502 any other AI failure. Rethrows anything else.
function refuse(error: unknown, res: Response) {
  if (error instanceof IntakeError) {
    res
      .status(error.status)
      .json({ error: error.message, ...(error.files && { files: error.files }) })
    return
  }
  if (error instanceof AssessmentFieldsError) {
    res.status(400).json({ error: 'The assessment details are invalid.', fields: error.fields })
    return
  }
  if (error instanceof RagServiceError) {
    res.status(error.status === 503 ? 503 : 502).json({ error: error.message })
    return
  }
  if (error instanceof IngestionUnavailableError) {
    res.status(503).json({ error: error.message })
    return
  }
  throw error
}

// Runs a handler and turns its refusals into responses.
const guarded =
  (handler: (req: Request<Record<string, string>>, res: Response) => Promise<void>) =>
  async (req: Request<Record<string, string>>, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      refuse(error, res)
    }
  }

// Adds documents: multipart `file` parts and an optional `pastedText` field.
// 201 with each file kept or refused and why (AC1, AC4); 400 when none is kept
// and no text was pasted.
router.post(
  '/',
  edit,
  multipartBody,
  guarded(async (req, res) => {
    const form = await readForm(req)
    if (!form) {
      res.status(400).json({ error: 'Send the documents as a multipart form.' })
      return
    }
    const pasted = form.get('pastedText')
    const pastedText = typeof pasted === 'string' ? pasted.trim() : ''
    if (pastedText.length > PASTED_TEXT_LIMIT) {
      res.status(400).json({ error: 'The pasted text is too long. Paste one email at a time.' })
      return
    }
    const files = await documentFiles(form)
    res.status(201).json(await startIntake(files, pastedText || undefined, res.locals.user!))
  }),
)

// Reads the documents into the proposed client, sites and assessments (AC2-AC9),
// in place (about 15-25 s). A repeat returns the saved proposal.
router.post(
  '/:id/read',
  edit,
  guarded(async (req, res) => void res.json(await readIntake(req.params.id, res.locals.user!))),
)

// Creates the records from the checked form, keeping each listed document
// where it was placed (AC10, AC11). 201; a repeat returns the same records.
router.post(
  '/:id/create',
  edit,
  guarded(async (req, res) => {
    const form = newAssessmentsSchema.safeParse(req.body)
    const documents = intakeDocumentsSchema.safeParse(req.body?.documents)
    if (!form.success || !documents.success) {
      const fields = {
        ...(!form.success && fieldErrors(form.error)),
        ...(!documents.success &&
          Object.fromEntries(
            Object.entries(fieldErrors(documents.error)).map(([k, v]) => [`documents.${k}`, v]),
          )),
      }
      res.status(400).json({ error: 'The assessment details are invalid.', fields })
      return
    }
    res
      .status(201)
      .json(await createFromIntake(req.params.id, form.data, documents.data, res.locals.user!))
  }),
)

// Discards the documents without creating anything (AC13). 204; 409 once Create has claimed it.
router.delete(
  '/:id',
  edit,
  guarded(async (req, res) => {
    await discardIntake(req.params.id, res.locals.user!)
    res.status(204).end()
  }),
)

router.use(documentsTooLarge)

export default router
