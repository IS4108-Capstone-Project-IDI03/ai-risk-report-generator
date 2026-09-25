import { z } from 'zod'
import { USER_ROLES, UserModel, type IUser } from '../models/user.model'
import { isDuplicateKeyError } from './mongo-errors'

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
  updatedAt: Date
}

// Sorted by name so the list reads like a directory.
export async function listUsers(): Promise<UserDto[]> {
  const users = await UserModel.find().sort({ name: 1 }).lean()
  return users.map(toDto)
}

export async function getUser(id: string): Promise<UserDto> {
  const user = isObjectId(id) ? await UserModel.findById(id).lean() : null
  if (!user) throw new UserNotFoundError()
  return toDto(user)
}

// Replaces the editable profile fields and returns the saved account.
export async function updateUser(id: string, profile: UserProfile): Promise<UserDto> {
  if (!isObjectId(id)) throw new UserNotFoundError()

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

  try {
    const user = await UserModel.findByIdAndUpdate(
      id,
      Object.keys($unset).length ? { $set, $unset } : { $set },
      { returnDocument: 'after', runValidators: true },
    ).lean()
    if (!user) throw new UserNotFoundError()
    return toDto(user)
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) throw new UserEmailTakenError()
    throw error
  }
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
    updatedAt: user.updatedAt,
  }
}
