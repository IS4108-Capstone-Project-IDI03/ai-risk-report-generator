import { Router, type Response } from 'express'
import { getClientPage } from '../services/client-page.service'
import {
  ClientSiteError,
  ClientSiteFieldError,
  clientNameSchema,
  DuplicateSiteError,
  listClients,
  listClientSites,
  removeClient,
  renameClient,
  restoreClient,
  UnknownClientError,
  UnknownFacilityTypeError,
} from '../services/client.service'
import { fieldErrors } from './field-errors'
import { requirePermission } from '../middleware/auth.middleware'

const router = Router()

// Answers a refused change to a client or site (CP-18) with its status: 400
// naming the field, 403 not the engineer's to change, 404 unknown, 409 in the
// wrong state. Rethrows anything else. Shared with site.routes.
export function refuseClientChange(error: unknown, res: Response) {
  if (error instanceof ClientSiteError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  const field =
    error instanceof ClientSiteFieldError
      ? error.field
      : error instanceof DuplicateSiteError
        ? 'name'
        : error instanceof UnknownFacilityTypeError
          ? 'facilityType'
          : null
  if (!field || !(error instanceof Error)) throw error
  res.status(400).json({ error: error.message, fields: { [field]: error.message } })
}

// Every client, for the create form (CP-17 AC3, AC11). Only those who create
// assessments need them.
router.get('/', requirePermission('assessments:edit'), async (_req, res) => {
  res.json(await listClients())
})

// The client's sites, each with its latest visit (AC4, AC5). 404 for an
// unknown client.
router.get('/:id/sites', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await listClientSites(req.params.id))
  } catch (error: unknown) {
    if (error instanceof UnknownClientError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// The client page (CP-18): the engineer's sites at the client, their own
// visits there, and what they may change. 403 when they have no assessment
// for it, 404 unknown.
router.get('/:id', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await getClientPage(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

// Renames the client for all its assessments (CP-18): 204, or 400 a name
// another client has, 403 another engineer's assessment, 409 finalised or
// removed.
router.put('/:id', requirePermission('assessments:edit'), async (req, res) => {
  const parsed = clientNameSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'The client name is invalid.', fields: fieldErrors(parsed.error) })
    return
  }
  try {
    await renameClient(req.params.id, parsed.data.name, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

// Removes the client: all its listed sites, as one removal (CP-18). 204, or
// 403, or 409 an assessment not archived, finalised, or already removed.
router.post('/:id/remove', requirePermission('assessments:edit'), async (req, res) => {
  try {
    await removeClient(req.params.id, res.locals.user!)
    res.status(204).end()
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

// Restores the sites removed with the client (CP-18): 200 with how many came
// back, and the names of any held back because the client has since given
// another site that name. 403, or 409 when none were removed with it.
router.post('/:id/restore', requirePermission('assessments:edit'), async (req, res) => {
  try {
    res.json(await restoreClient(req.params.id, res.locals.user!))
  } catch (error: unknown) {
    refuseClientChange(error, res)
  }
})

export default router
