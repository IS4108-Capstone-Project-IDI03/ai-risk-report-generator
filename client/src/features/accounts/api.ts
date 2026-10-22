// Gateway (S2) calls for user account profiles (F-03) and new accounts (F-08).
import { GatewayError, reportSessionEnded } from '../assessments/api'

// The two agreed roles (F-05). What each may do comes from the gateway with
// the session (see features/auth/access.ts).
export type UserRole = 'risk_engineer' | 'knowledge_admin'

export const ROLE_LABELS: Record<UserRole, string> = {
  risk_engineer: 'Risk engineer',
  knowledge_admin: 'Knowledge admin',
}

// A role the gateway sent that this client does not know, e.g. from an
// account saved before F-05, is shown as it is rather than blank.
export function roleLabel(role: string) {
  return ROLE_LABELS[role as UserRole] ?? role
}

export type UserAccount = {
  id: string
  staffId: string
  name: string
  email: string
  role: UserRole
  jobTitle: string | null
  phone: string | null
  office: string | null
  active: boolean
  // False until the owner sets a password from their invitation (F-08).
  passwordSet: boolean
  // When the latest invitation link expires (or expired), while no password
  // is set; null once one is, or when no invitation could be sent.
  invitationExpiresAt: string | null
  updatedAt: string
}

// The editable profile. Optional fields are sent as '' to clear them.
export type UserProfile = {
  name: string
  email: string
  role: UserRole
  jobTitle: string
  phone: string
  office: string
  active: boolean
}

// A new account (F-08): no staff ID (the gateway assigns one) and no active
// flag (it starts active). Role is '' until one is chosen; optional fields
// are sent as '' when left empty.
export type NewUserAccount = Omit<UserProfile, 'role' | 'active'> & { role: UserRole | '' }

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error: unknown) {
    if (init.signal?.aborted) throw error
    throw new GatewayError(null)
  }
  // Proxies, including Vite's dev proxy, answer 502/504 when the gateway is down.
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (response.status === 401) reportSessionEnded()
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      error?: string
      fields?: Record<string, string>
    }
    throw new GatewayError(response.status, problem.error, problem.fields)
  }
  return (await response.json()) as T
}

export function listUsers(signal?: AbortSignal): Promise<UserAccount[]> {
  return request<UserAccount[]>('/api/users', { signal })
}

export function getUser(id: string, signal?: AbortSignal): Promise<UserAccount> {
  return request<UserAccount>(`/api/users/${encodeURIComponent(id)}`, { signal })
}

// Saves the whole editable profile and returns the stored account.
export function updateUser(id: string, profile: UserProfile): Promise<UserAccount> {
  return request<UserAccount>(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
}

// Creates an active account, emails its owner an invitation to set a
// password, and returns it with its staff ID; invitationExpiresAt is null if
// that email could not be sent. Rejects with the gateway's per-field problems
// (400), or an email already in use (409).
export function createUser(account: NewUserAccount): Promise<UserAccount> {
  return request<UserAccount>('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
}

// Emails a new invitation link to someone who has not set a password yet
// (F-08), and returns the account with the new link's expiry. Rejects with
// 409 when they already have a password or the account is deactivated, and
// 503 when the email could not be sent.
export function resendInvitation(id: string): Promise<UserAccount> {
  return request<UserAccount>(`/api/users/${encodeURIComponent(id)}/invitation`, {
    method: 'POST',
  })
}
