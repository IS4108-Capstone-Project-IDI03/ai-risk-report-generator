import type { NextFunction, Request, Response } from 'express'
import { verifySession, type SessionUser } from '../services/auth.service'

export const SESSION_COOKIE = 'session'

declare module 'express-serve-static-core' {
  interface Locals {
    user?: SessionUser
  }
}

// Verifies the session cookie and sets res.locals.user. 401 if missing/invalid
// — every protected route sits behind this first.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
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

// ponytail: minimal role->permission map so F-05 (role permissions) has a
// real primitive to build on today instead of guessing at auth's shape.
// F-05 owns replacing this with the agreed permission matrix.
const ROLE_PERMISSIONS: Record<SessionUser['role'], string[]> = {
  knowledge_admin: ['*'],
  risk_engineer: ['assessments:capture', 'assessments:view'],
  reviewer: ['assessments:view'],
}

// Composable per-route permission gate, e.g.
// router.post('/', requireAuth, requirePermission('assessments:capture'), handler)
export function requirePermission(permission: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user
    const allowed = user && ROLE_PERMISSIONS[user.role]
    if (!allowed || (!allowed.includes('*') && !allowed.includes(permission))) {
      res.status(403).json({ error: 'Not permitted.' })
      return
    }
    next()
  }
}
