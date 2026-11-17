// Gateway (S2) calls for the Settings screen (S-01).
// Called by Settings.tsx and its sections. Calls /api/settings and /api/auth/change-password.
import { request } from '../accounts/api'

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
// value is what applies to me; own is my saved value, or null when I use the default.
export type PersonalSetting<T> = { value: T | null; own: T | null; default: T | null }
export type PersonalKey =
  'standardsTargetPct' | 'defaultCountry' | 'defaultFacilityType' | 'defaultTitle'
export type PersonalValue = number | string | null
export type QaStrictness = 'strict' | 'standard' | 'lenient'
export type Settings = {
  canEditGlobal: boolean
  models: ModelRowData[]
  qaStrictness: QaStrictness
  personal: Record<PersonalKey, PersonalSetting<PersonalValue>>
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
/** Admin: saves QA strictness and/or the default values for everyone. */
export function saveGlobal(body: { qaStrictness?: QaStrictness; defaults?: object }) {
  return send('PATCH', '/api/settings/global', body)
}
/** Saves my own value (null clears it, so the admin default applies). */
export function saveMine(body: Partial<Record<PersonalKey, PersonalValue>>) {
  return send('PATCH', '/api/settings/me', body)
}
/** Changes my password; rejects with GatewayError (400 with fields, or 429 when locked). */
export async function changePassword(currentPassword: string, newPassword: string) {
  await request<{ message: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}
