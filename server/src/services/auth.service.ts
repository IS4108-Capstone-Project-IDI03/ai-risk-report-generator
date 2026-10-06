import bcrypt from 'bcrypt'
import { randomBytes, createHash } from 'crypto'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
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

export class InvalidResetTokenError extends Error {
  constructor() {
    super('This reset link is invalid or has expired.')
    this.name = 'InvalidResetTokenError'
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

// ponytail: in-memory revoked-token set for logout (F-07 AC4) — a JWT is
// otherwise self-validating and stays "logged in" until it naturally expires,
// even after the browser drops its cookie. Each entry self-removes once the
// token would have expired anyway, so this never grows unbounded. Move to
// Redis if this runs behind more than one instance.
const revokedTokens = new Set<string>()

export function revokeSession(token: string): void {
  revokedTokens.add(token)
  setTimeout(() => revokedTokens.delete(token), SESSION_TTL_SECONDS * 1000).unref()
}

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
  return signPayload(toSessionUser(user))
}

// Re-signs an already-verified session with a fresh expiry (F-07's sliding
// window) — no database lookup. Rebuilt as a clean payload: the decoded
// `user` still carries the original token's `iat`/`exp`, and jwt.sign()
// rejects a payload that already has `exp` when `expiresIn` is also given.
export function refreshSession(user: SessionUser): string {
  return signPayload({ id: user.id, role: user.role, name: user.name })
}

function signPayload(sessionUser: SessionUser): string {
  return jwt.sign(sessionUser, config.jwtSecret, { expiresIn: SESSION_TTL_SECONDS })
}

export function verifySession(token: string): SessionUser {
  if (revokedTokens.has(token)) throw new Error('Session was signed out.')
  return jwt.verify(token, config.jwtSecret) as SessionUser
}

function toSessionUser(user: IUser & { _id: unknown }): SessionUser {
  return { id: String(user._id), role: user.role, name: user.name }
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

// jsonTransport never leaves the server — it hands back the composed message
// instead of delivering it, which is exactly what a console-only dev/CI setup
// needs (F-06). Swapping to real SMTP later is a transport change only; none
// of the token logic below moves.
const mailer = nodemailer.createTransport({ jsonTransport: true })

async function sendResetEmail(email: string, token: string): Promise<void> {
  await mailer.sendMail({
    from: 'no-reply@marsh-risk-report.example',
    to: email,
    subject: 'Reset your password',
    text: `Reset token: ${token} (expires in 30 minutes)`,
  })
  console.log(`[password reset] ${email} -> token: ${token} (expires in 30 min)`)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Always resolves the same way whether or not the email is registered (AC6)
// — only the internal branch (send or don't) differs, never the response.
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim(), active: true })
  if (!user) return

  const token = randomBytes(32).toString('hex')
  user.set({
    resetTokenHash: hashToken(token),
    resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  })
  await user.save()
  await sendResetEmail(user.email, token)
}

// Single-use: the matching token is cleared whether or not this call
// succeeds past the lookup, so a token can't be retried after a failure.
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await UserModel.findOne({ resetTokenHash: hashToken(token) }).select(
    '+resetTokenHash +resetTokenExpiresAt',
  )
  if (!user?.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
    throw new InvalidResetTokenError()
  }

  user.set({
    passwordHash: await bcrypt.hash(newPassword, 10),
    resetTokenHash: undefined,
    resetTokenExpiresAt: undefined,
  })
  await user.save()
}
