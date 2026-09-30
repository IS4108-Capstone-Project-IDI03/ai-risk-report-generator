import { Router } from 'express'
import { InvalidCredentialsError, login, SESSION_TTL_SECONDS } from '../services/auth.service'
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.middleware'

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
    res.json({ user })
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

router.get('/me', requireAuth, (_req, res) => {
  res.json({ user: res.locals.user })
})

export default router
