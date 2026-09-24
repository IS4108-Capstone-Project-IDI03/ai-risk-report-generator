import { Router } from 'express'
import { createAssessment, newAssessmentSchema } from '../services/assessment.service'
import { AssessmentNotFoundError, startCaptureSession } from '../services/capture-session.service'

const router = Router()

// Creates an assessment (and its site). 400 lists the first problem with each
// invalid field, keyed by path, e.g. { "site.name": "Site name is required." }.
router.post('/', async (req, res) => {
  const parsed = newAssessmentSchema.safeParse(req.body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.')
      fields[path] ??= issue.message
    }
    res.status(400).json({ error: 'The assessment details are invalid.', fields })
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

export default router
