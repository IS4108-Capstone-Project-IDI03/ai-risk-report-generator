import { timingSafeEqual } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from '../config'

// Authenticates a call from another service by a shared secret in the
// x-service-key header. Used only for the internal notification endpoint,
// which sits outside the session-cookie chain so a microservice can reach it
// without a user. 401 with no detail on any mismatch, so a caller cannot tell
// a wrong key from an unset one.
//
// Fails closed: if SERVICE_API_KEY is not configured, every request is
// rejected. An absent key must never mean the endpoint is open.
export function requireServiceKey(req: Request, res: Response, next: NextFunction) {
  const expected = config.serviceApiKey
  const presented = req.get('x-service-key')
  if (!expected || !presented || !sameSecret(presented, expected)) {
    res.status(401).json({ error: 'Service authentication required.' })
    return
  }
  next()
}

// Constant-time compare, so the time taken does not leak how much of the key
// matched. timingSafeEqual needs equal-length buffers, so unequal lengths are
// a plain false — the length itself is not a useful secret.
function sameSecret(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
