// Gateway (S2) calls for user account profiles (F-03).
import { GatewayError } from '../assessments/api'

export type UserRole = 'risk_engineer' | 'reviewer' | 'knowledge_admin'

export const ROLE_LABELS: Record<UserRole, string> = {
  risk_engineer: 'Risk engineer',
  reviewer: 'Reviewer',
  knowledge_admin: 'Knowledge admin',
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error: unknown) {
    if (init.signal?.aborted) throw error
    throw new GatewayError(null)
  }
  // Proxies, including Vite's dev proxy, answer 502/504 when the gateway is down.
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
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
