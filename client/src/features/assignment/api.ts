// Gateway calls for assigning assessments to engineers (RV-11): who can be picked,
// and moving an assessment to someone else. Called by useAssignableEngineers.ts and
// the Reassign dialog. Shapes must match server/src/routes/assessment.routes.ts.
import { request, type Assessment } from '../assessments/api'
import type { UserRole } from '../accounts/api'

// An active account an assessment can go to; role is the gateway's raw value.
export type Person = { id: string; name: string; role: UserRole }

/** Returns the active accounts, sorted by name, the caller included (admins only). */
export async function listAssignableEngineers(signal?: AbortSignal): Promise<Person[]> {
  const { data } = await request<{ items: Person[] }>(
    'GET',
    '/api/assessments/assignable-engineers',
    undefined,
    signal,
  )
  return data.items
}

/** Returns the assessment's row once moved; a 409 means it was archived meanwhile. */
export async function reassignAssessment(
  reference: string,
  engineerId: string,
): Promise<Assessment> {
  const path = `/api/assessments/${encodeURIComponent(reference)}/reassign`
  return (await request<Assessment>('POST', path, { engineerId })).data
}
