import { z } from 'zod'
import { USER_ROLES, UserModel, type IUser } from '../models/user.model'
import { sendInvitation } from './invitation.service'
import { duplicateKeyField, isDuplicateKeyError } from './mongo-errors'
import { nextInSequence } from './sequence.service'

export class UserNotFoundError extends Error {
  constructor() {
    super('The account was not found.')
    this.name = 'UserNotFoundError'
  }
}

// Another account already uses the email. Reported against the email field.
export class UserEmailTakenError extends Error {
  constructor() {
    super('Another account already uses this email.')
    this.name = 'UserEmailTakenError'
  }
}

// A knowledge admin tried to change their own role or deactivate themselves,
// which could leave nobody able to assign roles. Another admin must do it.
export class OwnAccessChangeError extends Error {
  constructor(readonly field: 'role' | 'active') {
    super(
      field === 'role'
        ? 'You cannot change your own role. Ask another knowledge admin.'
        : 'You cannot deactivate your own account. Ask another knowledge admin.',
    )
    this.name = 'OwnAccessChangeError'
  }
}

// A knowledge admin asked to resend an invitation (F-08) that has no use:
// the owner already has a password, or the account cannot sign in.
export class InvitationNotNeededError extends Error {
  constructor(reason: 'password-set' | 'inactive') {
    super(
      reason === 'password-set'
        ? 'This person has already set a password. If they have forgotten it, they can use Reset password on the sign-in screen.'
        : 'This account is deactivated. Reactivate it before sending an invitation.',
    )
    this.name = 'InvitationNotNeededError'
  }
}

// The invitation email could not be sent, e.g. the mail server is down.
export class InvitationNotSentError extends Error {
  constructor() {
    super('The invitation email could not be sent. Try again in a few minutes.')
    this.name = 'InvitationNotSentError'
  }
}

const optional = (label: string, max: number) =>
  z
    .string(`${label} must be text.`)
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => value || undefined)

// Request body for PUT /api/users/:id: the whole editable profile. Optional
// fields sent empty are cleared. staffId is fixed and not accepted here.
export const userProfileSchema = z.object({
  name: z
    .string('Name is required.')
    .trim()
    .min(1, 'Name is required.')
    .max(100, 'Name must be 100 characters or fewer.'),
  email: z
    .string('Email is required.')
    .trim()
    .toLowerCase()
    .min(1, 'Email is required.')
    .max(254, 'Email must be 254 characters or fewer.')
    .pipe(z.email('Enter an email address such as name@example.com.')),
  role: z.enum(USER_ROLES, 'Choose a role.'),
  jobTitle: optional('Job title', 100),
  phone: optional('Phone', 30).refine(
    (value) => value === undefined || /^\+?[0-9][0-9 ()-]{5,}$/.test(value),
    'Phone may contain only digits, spaces, brackets, hyphens and a leading +.',
  ),
  office: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z
      .string()
      .regex(/^[A-Z]{2}$/, 'Office must be a two-letter jurisdiction code, e.g. SG.')
      .optional(),
  ),
  active: z.boolean('Choose whether the account is active.'),
})

export type UserProfile = z.infer<typeof userProfileSchema>

// Request body for POST /api/users (F-08): the same fields, less `active`,
// since a new account always starts active. The staff ID is assigned.
export const newUserSchema = userProfileSchema.omit({ active: true })

export type NewUser = z.infer<typeof newUserSchema>

export type UserDto = {
  id: string
  staffId: string
  name: string
  email: string
  role: IUser['role']
  jobTitle: string | null
  phone: string | null
  office: string | null
  active: boolean
  // False until the owner sets a password from their invitation (F-08).
  passwordSet: boolean
  // When the latest invitation link expires (or expired), while no password
  // is set; null once one is, or when no invitation was ever sent.
  invitationExpiresAt: Date | null
  updatedAt: Date
}

// Every read selects the password hash, only so toDto can say whether one is
// set (F-08); the hash itself never leaves this module.
const WITH_PASSWORD = '+passwordHash'

// Sorted by name so the list reads like a directory.
export async function listUsers(): Promise<UserDto[]> {
  const users = await UserModel.find().select(WITH_PASSWORD).sort({ name: 1 }).lean()
  return users.map(toDto)
}

export async function getUser(id: string): Promise<UserDto> {
  const user = isObjectId(id) ? await UserModel.findById(id).select(WITH_PASSWORD).lean() : null
  if (!user) throw new UserNotFoundError()
  return toDto(user)
}

// Creates an active account with the next free staff ID, e.g. MRE-0005, and
// returns it. It has no password yet: its owner is emailed an invitation to
// set one, then signs in to their role's screens. If that email can't be
// sent, the account is still created; it shows no invitation link, and the
// admin can resend one from its profile.
export async function createUser(input: NewUser): Promise<UserDto> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const staffId = `MRE-${String(await nextInSequence('staff')).padStart(4, '0')}`
    let user: IUser & { _id: unknown }
    try {
      user = (await UserModel.create({ ...input, staffId, active: true })).toObject()
    } catch (error: unknown) {
      if (duplicateKeyField(error) === 'email') throw new UserEmailTakenError()
      // A staff ID already in use, e.g. a seeded account: take the next one.
      if (!isDuplicateKeyError(error)) throw error
      continue
    }
    await sendInvitation(user)
    return getUser(String(user._id))
  }
  throw new Error('No unused staff ID found.')
}

// Emails a new invitation link to an account whose owner has not set a
// password yet, e.g. after the last one expired (F-08). The earlier link
// stops working.
export async function resendInvitation(id: string): Promise<UserDto> {
  const user = isObjectId(id) ? await UserModel.findById(id).select(WITH_PASSWORD).lean() : null
  if (!user) throw new UserNotFoundError()
  if (user.passwordHash) throw new InvitationNotNeededError('password-set')
  if (!user.active) throw new InvitationNotNeededError('inactive')
  if (!(await sendInvitation(user))) throw new InvitationNotSentError()
  return getUser(id)
}

// Replaces the editable profile fields and returns the saved account.
// actorId is the signed-in admin, who may edit their own details but not
// their own role or active flag. Correcting the email of someone who has not
// set a password yet cancels the invitation sent to the old address and, if
// the account is active, sends a new one to the corrected address (F-08).
export async function updateUser(
  id: string,
  profile: UserProfile,
  actorId?: string,
): Promise<UserDto> {
  const current = isObjectId(id) ? await UserModel.findById(id).select(WITH_PASSWORD).lean() : null
  if (!current) throw new UserNotFoundError()
  if (actorId === id) {
    if (current.role !== profile.role) throw new OwnAccessChangeError('role')
    if (current.active && !profile.active) throw new OwnAccessChangeError('active')
  }
  const reinvite = !current.passwordHash && current.email !== profile.email

  const $set: Partial<IUser> = {
    name: profile.name,
    email: profile.email,
    role: profile.role,
    active: profile.active,
  }
  const $unset: Record<string, ''> = {}
  for (const key of ['jobTitle', 'phone', 'office'] as const) {
    const value = profile[key]
    if (value === undefined) $unset[key] = ''
    else $set[key] = value
  }
  if (reinvite) {
    $unset.inviteTokenHash = ''
    $unset.inviteTokenExpiresAt = ''
  }

  let user: (IUser & { _id: unknown }) | null
  try {
    user = await UserModel.findByIdAndUpdate(
      id,
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { returnDocument: 'after', runValidators: true },
    )
      .select(WITH_PASSWORD)
      .lean()
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) throw new UserEmailTakenError()
    throw error
  }
  if (!user) throw new UserNotFoundError()
  if (reinvite && user.active && !user.passwordHash) {
    await sendInvitation(user)
    return getUser(id)
  }
  return toDto(user)
}

function isObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id)
}

function toDto(user: IUser & { _id: unknown }): UserDto {
  return {
    id: String(user._id),
    staffId: user.staffId,
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle ?? null,
    phone: user.phone ?? null,
    office: user.office ?? null,
    active: user.active,
    passwordSet: Boolean(user.passwordHash),
    invitationExpiresAt: user.passwordHash ? null : (user.inviteTokenExpiresAt ?? null),
    updatedAt: user.updatedAt,
  }
}
