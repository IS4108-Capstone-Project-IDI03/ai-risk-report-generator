import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { UserModel, type IUser, type UserRole } from '../models/user.model'

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Incorrect email or password.')
    this.name = 'InvalidCredentialsError'
  }
}

export class TooManyAttemptsError extends Error {
  constructor() {
    super('Too many failed attempts. Try again in a few minutes.')
    this.name = 'TooManyAttemptsError'
  }
}

// Session lifetime (F-04/F-07 share this — one expiry concept, not two).
export const SESSION_TTL_SECONDS = 15 * 60

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

// ponytail: in-memory per-email lockout — fine for a single server instance;
// move to Redis (shared with the rate-limit store) if this runs behind more
// than one instance.
const failedAttempts = new Map<string, { count: number; lockedUntil?: number }>()

export type SessionUser = { id: string; role: UserRole; name: string }

// Verifies credentials and returns a signed session token plus the account.
// Never distinguishes "no such email" from "wrong password" — both are the
// same generic error, so a login attempt can't be used to enumerate accounts.
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  const key = email.toLowerCase().trim()
  const record = failedAttempts.get(key)
  if (record?.lockedUntil && record.lockedUntil > Date.now()) {
    throw new TooManyAttemptsError()
  }

  const user = await UserModel.findOne({ email: key }).select('+passwordHash')
  // A deactivated account (F-03) cannot sign in; same generic error.
  if (!user?.passwordHash || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    const attempts = (record?.count ?? 0) + 1
    failedAttempts.set(key, {
      count: attempts,
      lockedUntil: attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : undefined,
    })
    throw new InvalidCredentialsError()
  }

  failedAttempts.delete(key)
  return { token: signSession(user), user: toSessionUser(user) }
}

export function signSession(user: IUser & { _id: unknown }): string {
  const sessionUser = toSessionUser(user)
  return jwt.sign(sessionUser, config.jwtSecret, { expiresIn: SESSION_TTL_SECONDS })
}

export function verifySession(token: string): SessionUser {
  return jwt.verify(token, config.jwtSecret) as SessionUser
}

function toSessionUser(user: IUser & { _id: unknown }): SessionUser {
  return { id: String(user._id), role: user.role, name: user.name }
}
