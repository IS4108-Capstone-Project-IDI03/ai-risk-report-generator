import type { NextFunction, Request, Response } from 'express'
import {
  refreshSession,
  SESSION_TTL_SECONDS,
  verifySession,
  type SessionUser,
} from '../services/auth.service'
import { hasPermission, type Permission } from '../services/permissions.service'

export const SESSION_COOKIE = 'session'

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: SESSION_TTL_SECONDS * 1000,
}

declare module 'express-serve-static-core' {
  interface Locals {
    user?: SessionUser
  }
}

// Verifies the session cookie and sets res.locals.user. 401 if missing/invalid
// — every protected route sits behind this first. A valid session gets a
// fresh cookie (F-07): 15 minutes resets on each request, so it's inactivity
// that expires it, not a fixed time since login.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) {
    res.status(401).json({ error: 'Sign in required.' })
    return
  }
  try {
    const user = verifySession(token)
    res.locals.user = user
    res.cookie(SESSION_COOKIE, refreshSession(user), SESSION_COOKIE_OPTIONS)
    next()
  } catch {
    res.status(401).json({ error: 'Session expired or invalid.' })
  }
}

// Like requireAuth, but does NOT re-issue the session cookie. For routes the
// client polls on a timer — the notification count — so that polling cannot
// keep an idle session alive and defeat the F-07 inactivity logout. The
// session is still verified: an expired or missing cookie is 401 exactly as
// above; this simply does not extend it.
export function requireAuthNoRefresh(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) {
    res.status(401).json({ error: 'Sign in required.' })
    return
  }
  try {
    res.locals.user = verifySession(token)
    next()
  } catch {
    res.status(401).json({ error: 'Session expired or invalid.' })
  }
}

// Per-route permission gate from the agreed matrix (F-05), placed after
// requireAuth, e.g. router.post('/', requirePermission('assessments:edit'), handler).
// A signed-in user whose role lacks the permission gets 403, never the data.
// The request is typed `unknown` on purpose: typed as Express's Request, it
// would make TypeScript read each route's params as the generic
// `string | string[]` dictionary instead of from the route path.
export function requirePermission(permission: Permission) {
  return (_req: unknown, res: Response, next: NextFunction) => {
    const user = res.locals.user
    if (!user) {
      res.status(401).json({ error: 'Sign in required.' })
      return
    }
    if (!hasPermission(user.role, permission)) {
      res.status(403).json({ error: 'Your role does not allow this.' })
      return
    }
    next()
  }
}
