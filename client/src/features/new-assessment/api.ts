// Gateway calls for the New Assessment screen (CP-23): creating a client's
// sites and assessments by hand, and the client intake that reads documents.
// Called by useNewAssessment.ts and useIntake.ts. Calls the gateway through
// assessments/api.ts's request(); shapes must match the gateway's client-intake routes.
import { request, type Assessment } from '../assessments/api'

export type VisitType = 'First survey' | 'Resurvey' | 'Follow-up visit'
// The words a filled-in value came from, in one of the intake's documents.
export type Source = { documentId: string; quote: string }
// A value the AI filled in; value null means Not sure (left empty).
export type Field = { value: string | null; source: Source | null }

export type Placement =
  { kind: 'client' } | { kind: 'site'; ref: string } | { kind: 'assessment'; ref: string }

// What the form sends: one client, its sites, each with its assessments.
export type NewAssessments = {
  client: { id: string } | { name: string; division?: string }
  sites: ({
    ref: string
    id?: string
    copyLocations?: boolean
    name?: string
    address?: string
    coordinates?: { lat: number; lng: number }
    jurisdiction?: string
    facilityType?: string
  } & {
    assessments: {
      ref: string
      visitType: VisitType
      siteVisitDate?: string
      siteVisitEndDate?: string
      reportDueDate?: string
      siteContacts?: { name: string; role?: string }[]
    }[]
  })[]
}
export type Created = { clientId: string; assessments: Assessment[] }

// A refused file was not kept, so it has no id.
export type IntakeFile = {
  id: string | null
  name: string
  size: number
  status: 'accepted' | 'refused' | 'read' | 'failed'
  reason: string | null
}
// The AI's reading of the documents (rag-service's answer, camelCased by the gateway).
export type IntakeResult = {
  client: { name: Field; division: Field; existingId: string | null; matchNotSure: boolean }
  sites: {
    ref: string
    existingId: string | null
    matchNotSure: boolean
    name: Field
    address: Field
    jurisdiction: Field
    facilityType: Field
  }[]
  assessments: {
    ref: string
    siteRef: string
    visitType: Field
    siteVisitDate: Field
    siteVisitEndDate: Field
    reportDueDate: Field
    siteContacts: { name: string; role: string | null; source: Source | null }[]
  }[]
  documents: { fileId: string; placement: Placement; notSure: boolean }[]
}

// Each document the AI read, by the id sources quote: a file, an email's
// attachment ("<fileId>-<n>") or "pasted-text".
export type IntakeSource = { documentId: string; name: string; fileId: string | null }

/** Returns the created client's id and its new assessments (manual form). */
export async function createAssessments(body: NewAssessments): Promise<Created> {
  return (await request<Created>('POST', '/api/assessments', body)).data
}

/** Returns the new intake with each file accepted or refused (with its reason). */
export async function startIntake(files: File[], pastedText: string, signal?: AbortSignal) {
  const form = new FormData()
  for (const file of files) form.append('file', file)
  if (pastedText.trim()) form.append('pastedText', pastedText)
  return (
    await request<{ id: string; files: IntakeFile[] }>('POST', '/api/client-intakes', form, signal)
  ).data
}

const intakePath = (id: string) => `/api/client-intakes/${encodeURIComponent(id)}`

/** Returns each file's read status and the AI's reading; takes 10-25 s. */
export async function readIntake(id: string, signal?: AbortSignal) {
  return (
    await request<{ files: IntakeFile[]; sources: IntakeSource[]; result: IntakeResult }>(
      'POST',
      intakePath(id) + '/read',
      undefined,
      signal,
    )
  ).data
}

/** Discards an intake and its files; returns nothing. */
export async function discardIntake(id: string) {
  await request<void>('DELETE', intakePath(id))
}

// The same discard, sent as the tab closes: keepalive lets it outlive the page.
export function discardIntakeOnExit(id: string) {
  void fetch(intakePath(id), { method: 'DELETE', keepalive: true }).catch(() => {})
}

/** Returns the records created from an intake, its documents kept where placed. */
export async function createFromIntake(
  id: string,
  body: NewAssessments & { documents: { fileId: string; placement: Placement }[] },
): Promise<Created> {
  return (await request<Created>('POST', intakePath(id) + '/create', body)).data
}
