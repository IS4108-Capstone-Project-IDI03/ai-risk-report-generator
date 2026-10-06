// Service-to-service endpoint for creating notifications. Mounted in
// index.ts behind requireServiceKey and on its own path, outside the
// requireAuth chain every /api/* user route sits behind — a microservice
// (today, the ingestion worker) has no session, and nesting this under an
// authenticated mount is the easy way to ship it open by mistake.
import { Router } from 'express'
import { createNotification, externalNotificationSchema } from '../services/notification.service'
import { fieldErrors } from './field-errors'

const router = Router()

// Creates a notification from a validated body. 201 with the created
// notification, or 400 naming each invalid field. Auth is the service key,
// checked by requireServiceKey before this runs.
router.post('/', async (req, res) => {
  const parsed = externalNotificationSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The notification is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  res.status(201).json(await createNotification(parsed.data))
})

export default router
