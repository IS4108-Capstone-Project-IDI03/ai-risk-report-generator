import { Router } from 'express'
import { InvalidCredentialsError, login, SESSION_TTL_SECONDS } from '../services/auth.service'
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.middleware'
import { permissionsFor } from '../services/permissions.service'

const router = Router()

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: SESSION_TTL_SECONDS * 1000,
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  try {
    const { token, user } = await login(email, password)
    res.cookie(SESSION_COOKIE, token, cookieOptions)
    res.json({ user, permissions: permissionsFor(user.role) })
  } catch (error: unknown) {
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({ error: error.message })
      return
    }
    throw error
  }
})

router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE)
  res.status(204).end()
})

// The signed-in user and what their role allows (F-05), so the client can
// guard its screens with the same matrix the API enforces.
router.get('/me', requireAuth, (_req, res) => {
  const { id, role, name } = res.locals.user!
  res.json({ user: { id, role, name }, permissions: permissionsFor(role) })
})

export default router
