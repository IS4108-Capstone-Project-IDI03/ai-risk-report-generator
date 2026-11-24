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
/** Changes my password; rejects with GatewayError (400 with fields, or 429 when locked). */
export async function changePassword(currentPassword: string, newPassword: string) {
  await request<{ message: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

// PV-09: the knowledge admin's privacy word lists. Admins only; an engineer gets 403.
export type PrivacyKind = 'CLIENT' | 'SITE' | 'ADDRESS' | 'PERSON'
export type PrivacyList = 'always' | 'never'
export type PrivacyWord = {
  id: string
  list: PrivacyList
  word: string
  // Always masked only: the placeholder's kind. Null on Never masked.
  kind: PrivacyKind | null
  reason: string
  // `default`: shipped with the app (allow_list.json); `admin`: added in Settings.
  source: 'default' | 'admin'
  addedBy: { id: string; name: string } | null
  at: string
}
type WordChange = { list: PrivacyList; word: string; kind: PrivacyKind | null; reason: string }
// One add (before null) or removal (after null); newest first, at most 20.
export type PrivacyWordChange = {
  at: string
  by: { id: string; name: string }
  before: WordChange | null
  after: WordChange | null
}
export type PrivacyWords = {
  // The lists apply only when PII_PROTECTION is on (AC9).
  protectionOn: boolean
  always: PrivacyWord[]
  never: PrivacyWord[]
  history: PrivacyWordChange[]
}
// A word past reports had masked at ingestion (AC10): never its tag or which report.
export type MaskedWord = { word: string; kind: string; reports: number; neverMasked: boolean }

/** Admin: both lists and their last 20 changes. */
export function getPrivacyWords(): Promise<PrivacyWords> {
  return request<PrivacyWords>('/api/settings/privacy-words')
}
/** Admin: adds a word to one list; rejects with GatewayError (400, or 409 with the reason). */
export async function addPrivacyWord(body: {
  list: PrivacyList
  word: string
  reason: string
  kind?: PrivacyKind
}) {
  await request<unknown>('/api/settings/privacy-words', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}
/** Admin: removes one word from its list. */
export async function removePrivacyWord(id: string) {
  await request<unknown>(`/api/settings/privacy-words/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
/** Admin: every word past reports had masked, once each. */
export function getMaskedInReports(): Promise<{ words: MaskedWord[] }> {
  return request<{ words: MaskedWord[] }>('/api/settings/privacy-words/masked-in-reports')
}
