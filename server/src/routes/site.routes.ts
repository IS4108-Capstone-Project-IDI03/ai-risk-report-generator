import { Router } from 'express'
import { siteDetailsSchema } from '../services/assessment.service'
import { correctSite, removeSite, restoreSite, siteRestoreSchema } from '../services/client.service'
import { refuseClientChange } from './client.routes'
import { fieldErrors } from './field-errors'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// A site, by its own id rather than its client's (CP-18), so a site saved
// before clients (CP-17) can still be corrected from its assessment.

// Corrects its name, address, jurisdiction and facility type for every
// assessment at it: 204, or 400 naming the field (a name the client already
// has, a facility type off the list), 403 another engineer's assessment or
// none of the engineer's, 404, 409 finalised or removed.
router.put('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = siteDetailsSchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The site details are invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await correctSite(req.params.id, parsed.data, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

// Removes it, a soft removal: 204, or 403, 404, or 409 an assessment not
// archived, finalised, or already removed.
router.post('/:id/remove', requirePermission('assessments:edit'), async (req, res) => {
  try {
    await removeSite(req.params.id, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

// Restores it, under a new `name` when its client has since given another
// site its name: 204, or 400 that name taken, 403, 404, 409 not removed.
router.post('/:id/restore', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = siteRestoreSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'The site name is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await restoreSite(req.params.id, res.locals.user!, parsed.data.name)
    res.status(204).end()
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

export default router
