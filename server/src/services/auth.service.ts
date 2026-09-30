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

// Session lifetime (F-04/F-07 share this — one expiry concept, not two).
export const SESSION_TTL_SECONDS = 15 * 60

export type SessionUser = { id: string; role: UserRole; name: string }

// Verifies credentials and returns a signed session token plus the account.
// Never distinguishes "no such email" from "wrong password" — both are the
// same generic error, so a login attempt can't be used to enumerate accounts.
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).select(
    '+passwordHash',
  )
  // A deactivated account (F-03) cannot sign in; same generic error.
  if (!user?.passwordHash || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new InvalidCredentialsError()
  }
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
