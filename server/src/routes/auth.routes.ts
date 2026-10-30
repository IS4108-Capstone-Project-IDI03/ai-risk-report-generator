import { Router } from 'express'
import {
  InvalidCredentialsError,
  InvalidResetTokenError,
  login,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  TooManyAttemptsError,
} from '../services/auth.service'
import {
  acceptInvitation,
  InvalidInvitationError,
  lookUpInvitation,
  newPasswordSchema,
} from '../services/invitation.service'
import { requireAuth, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '../middleware/auth.middleware'
import { permissionsFor } from '../services/permissions.service'
import { countsForUser } from '../services/notification.service'

const router = Router()

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  try {
    const { token, user } = await login(email, password)
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    // The header seeds its unread badge and Load more from these, so it needs
    // no separate fetch on sign-in.
    res.json({
      user,
      permissions: permissionsFor(user.role),
      notifications: await countsForUser(user),
    })
  } catch (error: unknown) {
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({ error: error.message })
      return
    }
    if (error instanceof TooManyAttemptsError) {
      res.status(429).json({ error: error.message })
      return
    }
    throw error
  }
})

router.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) revokeSession(token)
  res.clearCookie(SESSION_COOKIE)
  res.status(204).end()
})

// Always 200 regardless of whether the email is registered (AC6) — an
// enumeration check can't tell the two cases apart from the response.
router.post('/request-reset', async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'Email is required.' })
    return
  }
  await requestPasswordReset(email)
  res.status(200).json({ message: 'If that email has an account, a reset link has been sent.' })
})

router.post('/reset', async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Token and new password are required.' })
    return
  }
  try {
    await resetPassword(token, password)
    res.status(200).json({ message: 'Password updated. Sign in with your new password.' })
  } catch (error: unknown) {
    if (error instanceof InvalidResetTokenError) {
      res.status(400).json({ error: error.message })
      return
    }
    throw error
  }
})

// A new employee's invitation link (F-08), checked when the set-password
// screen opens so a link that no longer works says so before a password is
// typed. 200 { name, email }; 400 for an invalid, used or expired link.
router.post('/invitation', async (req, res) => {
  const { token } = req.body ?? {}
  if (typeof token !== 'string') {
    res.status(400).json({ error: 'The invitation code is required.' })
    return
  }
  try {
    res.json(await lookUpInvitation(token))
  } catch (error: unknown) {
    if (error instanceof InvalidInvitationError) {
      res.status(400).json({ error: error.message })
      return
    }
    throw error
  }
})

// Sets a new employee's first password from their invitation link (F-08).
// Separate from /reset, which replaces a password the account already has.
// 400 with fields.password for a password that breaks the rules; 400 without
// fields for a link that no longer works.
router.post('/invitation/accept', async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string') {
    res.status(400).json({ error: 'The invitation code is required.' })
    return
  }
  const parsed = newPasswordSchema.safeParse(password)
  if (!parsed.success) {
    res.status(400).json({
      error: 'The password is not strong enough.',
      fields: { password: parsed.error.issues[0].message },
    })
    return
  }
  try {
    const { email } = await acceptInvitation(token, parsed.data)
    res.json({ email, message: 'Password set. Sign in with your work email and new password.' })
  } catch (error: unknown) {
    if (error instanceof InvalidInvitationError) {
      res.status(400).json({ error: error.message })
      return
    }
    throw error
  }
})

// The signed-in user and what their role allows (F-05), so the client can
// guard its screens with the same matrix the API enforces.
router.get('/me', requireAuth, async (_req, res) => {
  const user = res.locals.user!
  const { id, role, name } = user
  res.json({
    user: { id, role, name },
    permissions: permissionsFor(role),
    notifications: await countsForUser(user),
  })
})

export default router
