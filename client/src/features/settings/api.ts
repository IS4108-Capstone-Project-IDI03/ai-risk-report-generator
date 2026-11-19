// Gateway (S2) calls for the Settings screen (S-01).
// Called by Settings.tsx and its sections. Calls /api/settings and /api/auth/change-password.
import { request } from '../accounts/api'
import type { TierId } from './tiers'

export type ModelOption = {
  id: string
  provider: string
  model: string
  label: string
  recommended: boolean
  keySet: boolean
  // Shown greyed out. selectable=false means it cannot be chosen (no key).
  greyed: boolean
  selectable: boolean
  note: string | null
}
export type ModelRowData = {
  task: string
  label: string
  // Fixed in code (voice transcription): one option, never changes.
  fixed: boolean
  // False while no service reads the saved choice yet (OCR, classifiers).
  inUse?: boolean
  selected: string
  warning: string | null
  options: ModelOption[]
}
export type QaStrictness = 'strict' | 'standard' | 'lenient'
// One saved change of the source order (RT-04); newest first, at most 20.
export type SourcePriorityChange = {
  at: string
  by: { id: string; name: string }
  before: TierId[]
  after: TierId[]
}
export type Settings = {
  canEditGlobal: boolean
  models: ModelRowData[]
  qaStrictness: QaStrictness
  sourcePriority: { order: TierId[]; history: SourcePriorityChange[] }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const send = (method: string, path: string, body: unknown) =>
  request<Settings>(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) })

/** Returns everything the Settings screen shows for the signed-in person. */
export function getSettings(): Promise<Settings> {
  return request<Settings>('/api/settings')
}
/** Admin: saves the model for one task; returns the new settings. */
export function saveModel(task: string, option: string) {
  return send('PUT', `/api/settings/models/${encodeURIComponent(task)}`, { option })
}
/** Admin: saves the source authority order (highest first); returns the new settings. */
export function saveSourcePriority(order: TierId[]) {
  return send('PUT', '/api/settings/source-priority', { order })
}
/** Admin: saves the QA strictness for everyone. */
export function saveGlobal(body: { qaStrictness: QaStrictness }) {
  return send('PATCH', '/api/settings/global', body)
}
/** Changes my password; rejects with GatewayError (400 with fields, or 429 when locked). */
export async function changePassword(currentPassword: string, newPassword: string) {
  await request<{ message: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}
