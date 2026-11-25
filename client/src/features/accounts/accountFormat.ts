// Shared options and wording for the User accounts screens (F-03, F-05, F-08).
// Used by UserAccounts.tsx, the screens/ and the components/. No React in here.
import { GatewayError } from '../assessments/api'
import { JURISDICTIONS } from '../assessments/options'
import {
  ROLE_LABELS,
  type NewUserAccount,
  type UserAccount,
  type UserProfile,
  type UserRole,
} from './api'

export const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}))
// A new account has no role until the admin picks one (F-08).
export const NEW_ROLE_OPTIONS = [{ value: '', label: 'Choose a role' }, ...ROLE_OPTIONS]
export const OFFICE_OPTIONS = [{ value: '', label: 'Not set' }, ...JURISDICTIONS]
export const EMPTY_ACCOUNT: NewUserAccount = {
  name: '',
  email: '',
  role: '',
  jobTitle: '',
  phone: '',
  office: '',
}

/** Returns what the account list and profile say about an account: its label and Badge tone.
 * Deactivated comes first, since such an account cannot sign in whether or not a password is set.
 * Until the owner sets a password from their invitation (F-08), the account is pending. */
export function accountStatus(user: UserAccount): { label: string; tone: string } {
  if (!user.active) return { label: 'Deactivated', tone: 'neutral' }
  if (!user.passwordSet) return { label: 'Invitation pending', tone: 'info' }
  return { label: 'Active', tone: 'low' }
}

/** Returns a time such as "25 Oct 2026, 09:30", in the viewer's time zone. */
export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Returns the office's name, or "Not set". */
export function officeLabel(code: string | null) {
  if (!code) return 'Not set'
  return JURISDICTIONS.find((j) => j.value === code)?.label ?? code
}

/** Returns up to two capital letters of a name. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

/** Returns the sentence for a failed call: the cause, then the fix. */
export function problem(error: unknown, action: string) {
  if (error instanceof GatewayError && error.status === 404)
    return 'This account no longer exists. Return to the list and choose another account.'
  if (error instanceof GatewayError && error.status === null)
    return `Can't reach the server, so ${action}. Check your connection, then try again.`
  return `Something went wrong, so ${action}. Try again.`
}

/** Returns the editable fields of an account. */
export function toProfile(user: UserAccount): UserProfile {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle ?? '',
    phone: user.phone ?? '',
    office: user.office ?? '',
    active: user.active,
  }
}
