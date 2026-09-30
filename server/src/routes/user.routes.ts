import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import {
  getUser,
  listUsers,
  OwnAccessChangeError,
  updateUser,
  userProfileSchema,
  UserEmailTakenError,
  UserNotFoundError,
} from '../services/user.service'

const router = Router()

// Account profiles (F-03) and role assignment (F-05): knowledge admins only.
// Anyone else signed in gets 403 on every route here.
router.use(requirePermission('users:manage'))

router.get('/', async (_req, res) => {
  res.json(await listUsers())
})

router.get('/:id', async (req, res) => {
  try {
    res.json(await getUser(req.params.id))
  } catch (error: unknown) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    throw error
  }
})

// Saves the whole editable profile. 400 lists the first problem with each
// invalid field, e.g. { "email": "Enter an email address such as ..." }.
router.put('/:id', async (req, res) => {
  const parsed = userProfileSchema.safeParse(req.body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.')
      fields[path] ??= issue.message
    }
    res.status(400).json({ error: 'The profile details are invalid.', fields })
    return
  }
  try {
    res.json(await updateUser(req.params.id, parsed.data, res.locals.user?.id))
  } catch (error: unknown) {
    if (error instanceof OwnAccessChangeError) {
      res.status(400).json({
        error: 'The profile details are invalid.',
        fields: { [error.field]: error.message },
      })
      return
    }
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof UserEmailTakenError) {
      res.status(409).json({
        error: 'The profile details are invalid.',
        fields: { email: error.message },
      })
      return
    }
    throw error
  }
})

export default router
