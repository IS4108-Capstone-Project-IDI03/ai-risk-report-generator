import { Router } from 'express'
import {
  getUser,
  listUsers,
  updateUser,
  userProfileSchema,
  UserEmailTakenError,
  UserNotFoundError,
} from '../services/user.service'

const router = Router()

// Account profiles (F-03). Not authenticated yet: F-04 adds sign-in and
// restricts editing to knowledge admins.
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
    res.json(await updateUser(req.params.id, parsed.data))
  } catch (error: unknown) {
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
