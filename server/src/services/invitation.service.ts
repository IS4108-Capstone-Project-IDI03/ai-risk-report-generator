import bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import { config } from '../config'
import { UserModel } from '../models/user.model'
import { mailIsConfigured, sendMail } from './mail.service'

// Invitations (F-08): a new account has no password, so its owner is emailed
// a link to set the first one. This is its own flow, not the password reset
// (F-06): a reset replaces a password the account has, while an invitation
// works only for an account that has never had one.

// How long an invitation link works. Longer than a reset's 30 minutes, since
// a new employee may not read their work email on the day they are added.
export const INVITATION_TTL_HOURS = 72
const INVITATION_TTL_MS = INVITATION_TTL_HOURS * 60 * 60 * 1000

export class InvalidInvitationError extends Error {
  constructor() {
    super(
      'This invitation link is invalid, has expired or has already been used. Ask a knowledge admin to send you a new invitation.',
    )
    this.name = 'InvalidInvitationError'
  }
}

const PASSWORD_RULE = 'Use at least 12 characters, including a number and a symbol.'

// The rules for a first password. The set-password screen checks the same
// ones before sending. bcrypt reads only the first 72 bytes, so a longer
// password would be cut short without anyone knowing.
export const newPasswordSchema = z
  .string('Enter a password.')
  .min(12, PASSWORD_RULE)
  .refine((value) => /\d/.test(value) && /[^\w\s]/.test(value), PASSWORD_RULE)
  .refine((value) => Buffer.byteLength(value) <= 72, 'Use 72 characters or fewer.')

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// A link opens only while it is unexpired, for an active account that still
// has no password. So a deactivated account's link stops working, and so does
// any link once a password is set.
function openInvitation(token: string) {
  return {
    inviteTokenHash: hashToken(token),
    inviteTokenExpiresAt: { $gt: new Date() },
    active: true,
    passwordHash: { $exists: false },
  }
}

// Emails the account's owner a new link to set their password. The new link
// replaces any earlier one, which then stops working. Returns false when the
// email could not be sent; any earlier link is then left as it was. Saving
// the link changes the account's updatedAt, so callers read the account
// again rather than reuse the copy they passed in.
export async function sendInvitation(user: {
  _id: unknown
  name: string
  email: string
}): Promise<boolean> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
  const link = `${config.appUrl}/?invite=${token}`
  try {
    await sendMail({
      to: user.email,
      subject: 'Set up your Marsh Risk Report Generator account',
      text: [
        `Hello ${user.name},`,
        '',
        `A knowledge admin has created your Marsh Risk Report Generator account. Open this link to choose your password (it expires in ${INVITATION_TTL_HOURS} hours):`,
        '',
        link,
        '',
        `Then sign in with your work email, ${user.email}, and that password.`,
        '',
        'If the link has expired, ask a knowledge admin to send you a new invitation.',
      ].join('\n'),
    })
  } catch (error) {
    console.error(`[invitation] could not email ${user.email}:`, (error as Error).message)
    return false
  }
  await UserModel.updateOne(
    { _id: String(user._id) },
    { $set: { inviteTokenHash: hashToken(token), inviteTokenExpiresAt: expiresAt } },
  )
  // With no SMTP the console is the only inbox. With SMTP the code is a secret
  // and stays out of the logs.
  if (!mailIsConfigured()) {
    console.log(
      `[invitation] ${user.email} -> token: ${token} (expires in ${INVITATION_TTL_HOURS} hours)`,
    )
  }
  return true
}

// Who an invitation link is for, so the set-password screen can greet them
// and say when a link no longer works before they type a password.
export async function lookUpInvitation(token: string): Promise<{ name: string; email: string }> {
  const user = await UserModel.findOne(openInvitation(token)).select('name email').lean()
  if (!user) throw new InvalidInvitationError()
  return { name: user.name, email: user.email }
}

// Sets the account's first password and closes the link, in one update, so
// the same link can't set a password twice. Returns the email to sign in with.
export async function acceptInvitation(
  token: string,
  password: string,
): Promise<{ email: string }> {
  const passwordHash = await bcrypt.hash(password, 10)
  const user = await UserModel.findOneAndUpdate(openInvitation(token), {
    $set: { passwordHash },
    $unset: { inviteTokenHash: '', inviteTokenExpiresAt: '' },
  })
    .select('email')
    .lean()
  if (!user) throw new InvalidInvitationError()
  return { email: user.email }
}
