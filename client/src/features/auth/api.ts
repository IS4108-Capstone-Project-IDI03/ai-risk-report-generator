// Gateway (S2) calls for signing in and out (F-04), and the signed-in user's
// role permissions (F-05). The session itself is an httpOnly cookie the
// browser sends with every /api request; this module never sees the token.
import { GatewayError } from '../assessments/api'
import type { UserRole } from '../accounts/api'

// Matches PERMISSIONS in server/src/services/permissions.service.ts.
export type Permission =
  | 'assessments:view'
  | 'assessments:edit'
  | 'reports:generate'
  | 'knowledge:view'
  | 'knowledge:manage'
  | 'users:manage'

export type Session = {
  user: { id: string; name: string; role: UserRole }
  permissions: Permission[]
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init })
  } catch (error: unknown) {
    if (init.signal?.aborted) throw error
    throw new GatewayError(null)
  }
  // Proxies, including Vite's dev proxy, answer 502/504 when the gateway is down.
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  return response
}

async function problem(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return new GatewayError(response.status, body.error)
}

// Signs in. Wrong credentials, and too many attempts, reject with the
// gateway's status (401, 429) and its generic message.
export async function signIn(email: string, password: string): Promise<Session> {
  const response = await send('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  })
  if (!response.ok) throw await problem(response)
  return (await response.json()) as Session
}

// The session this browser already has, e.g. after a refresh; null when there
// is none or it has expired.
export async function currentSession(signal?: AbortSignal): Promise<Session | null> {
  const response = await send('/api/auth/me', { signal })
  if (response.status === 401) return null
  if (!response.ok) throw await problem(response)
  return (await response.json()) as Session
}

export async function signOut(): Promise<void> {
  const response = await send('/api/auth/logout', { method: 'POST' })
  if (!response.ok) throw await problem(response)
}

// Always resolves — the gateway answers identically whether or not the email
// is registered (F-06 AC6), so there's nothing to distinguish here.
export async function requestPasswordReset(email: string): Promise<void> {
  const response = await send('/api/auth/request-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  })
  if (!response.ok) throw await problem(response)
}

// Rejects (400) for an invalid, expired or already-used token.
export async function resetPassword(token: string, password: string): Promise<void> {
  const response = await send('/api/auth/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token.trim(), password }),
  })
  if (!response.ok) throw await problem(response)
}
