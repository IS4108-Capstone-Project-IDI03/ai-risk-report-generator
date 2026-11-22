// Gateway calls for walkthroughs (F-12): saving the record, the try-it quick check, the practice assessment.
// Called by engine.ts. Calls PATCH /api/settings/me and /api/walkthroughs (contract-gateway.md).
import { request } from '../accounts/api'
import type { RecordPatch } from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Saves one change to the walkthrough record; resolves when the gateway has it. */
export async function saveRecord(patch: RecordPatch): Promise<void> {
  await request<unknown>('/api/settings/me', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ walkthroughs: patch }),
  })
}

/** Returns whether a try-it walkthrough can run now (its AI and data are ready). */
export async function checkTryIt(id: string): Promise<boolean> {
  const { ok } = await request<{ ok: boolean }>(
    `/api/walkthroughs/check?for=${encodeURIComponent(id)}`,
  )
  return ok
}

/** Sets up (or resets) the practice assessment; returns its reference. */
export async function setUpPractice(): Promise<string> {
  const { reference } = await request<{ reference: string }>('/api/walkthroughs/practice', {
    method: 'POST',
  })
  return reference
}

/** Removes the practice assessment; resolves when done. */
export async function removePractice(): Promise<void> {
  // The route answers 204 with no body, which request() cannot parse: an empty-body
  // parse error after a successful delete is not a failure.
  await request<unknown>('/api/walkthroughs/practice', { method: 'DELETE' }).catch(
    (error: unknown) => {
      if (!(error instanceof SyntaxError)) throw error
    },
  )
}
