import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { fieldErrors } from './field-errors'
import {
  createUser,
  getUser,
  InvitationNotNeededError,
  InvitationNotSentError,
  listUsers,
  newUserSchema,
  OwnAccessChangeError,
  resendInvitation,
  updateUser,
  userProfileSchema,
  UserEmailTakenError,
  UserNotFoundError,
} from '../services/user.service'

const router = Router()

// Account profiles (F-03), role assignment (F-05) and new accounts (F-08):
// knowledge admins only.
// Anyone else signed in gets 403 on every route here.
router.use(requirePermission('users:manage'))

router.get('/', async (_req, res) => {
  res.json(await listUsers())
})

// Creates an active account (F-08), emails its owner an invitation to set a
// password, and returns it with its staff ID (201). invitationExpiresAt is
// null if the email could not be sent. 400 lists the first problem with each
// invalid field; an email another account uses is 409 against the email
// field. Nothing is saved or sent on either.
router.post('/', async (req, res) => {
  const parsed = newUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'The account details are invalid.',
      fields: fieldErrors(parsed.error),
    })
    return
  }
  try {
    res.status(201).json(await createUser(parsed.data))
  } catch (error: unknown) {
    if (error instanceof UserEmailTakenError) {
      res.status(409).json({
        error: 'The account details are invalid.',
        fields: { email: error.message },
      })
      return
    }
    throw error
  }
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

// Emails a new invitation link to someone who has not set a password yet
// (F-08); the earlier link stops working. 409 when they already have a
// password or the account is deactivated; 503 when the email can't be sent.
router.post('/:id/invitation', async (req, res) => {
  try {
    res.json(await resendInvitation(req.params.id))
  } catch (error: unknown) {
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: error.message })
      return
    }
    if (error instanceof InvitationNotNeededError) {
      res.status(409).json({ error: error.message })
      return
    }
    if (error instanceof InvitationNotSentError) {
      res.status(503).json({ error: error.message })
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
    res.status(400).json({
      error: 'The profile details are invalid.',
      fields: fieldErrors(parsed.error),
    })
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
