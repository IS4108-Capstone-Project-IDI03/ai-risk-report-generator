// Gateway (S2) calls for assessments. Requests go to /api, which Vite proxies
// to the gateway in development.

export type NewAssessment = {
  site: { name: string; address?: string; jurisdiction: string; facilityType: string }
  client: string
  policyReference?: string
  surveyType: string
  // YYYY-MM-DD, or '' when not scheduled.
  siteVisitDate?: string
  reportDueDate?: string
  standards: string[]
  // The assigned engineer's user ID.
  engineerId: string
}

// Capture statuses come from the assessment's capture session; report
// statuses are stored once a report exists.
export type AssessmentStatus =
  | 'not_started'
  | 'capturing'
  | 'ready_to_generate'
  | 'draft'
  | 'under_review'
  | 'finalised'
  | 'archived'

export type Assessment = {
  id: string
  reference: string
  client: string
  policyReference: string | null
  surveyType: string
  siteVisitDate: string | null
  reportDueDate: string | null
  standards: string[]
  engineer: { id: string; name: string } | null
  status: AssessmentStatus
  createdAt: string
  site: {
    code: string
    name: string
    address: string | null
    jurisdiction: string
    facilityType: string
  }
}

export type CaptureSession = {
  // True when the assessment's session in progress was returned (HTTP 200)
  // rather than a new one started (HTTP 201).
  resumed: boolean
  session: { id: string; status: 'active' | 'ready_for_generation'; startedAt: string }
  assessment: {
    id: string
    reference: string
    client: string
    site: { code: string; name: string } | null
  }
}

// A recording saved with an observation (CP-03). Its transcription runs after
// the save returns, so it starts as 'transcribing'.
export type TranscriptionStatus = 'transcribing' | 'transcribed' | 'failed'
export type SavedRecording = {
  id: string
  name: string
  contentType: string
  size: number
  url: string
  transcription: {
    status: TranscriptionStatus
    transcript: string | null
    error: string | null
    attempts: number
  }
}
// A place on site the engineer records observations in.
export type SiteLocation = { id: string; name: string; floor: string | null }

// An observation saved on the server: a note (CP-02), recordings (CP-03) or both.
export type SavedObservation = {
  id: string
  engineer: string
  // null when not categorised yet.
  copeDimension: string | null
  standard: string | null
  severity: string
  // null only if the location is no longer listed.
  location: SiteLocation | null
  // Exactly as the engineer wrote it.
  note: string | null
  recordings: SavedRecording[]
  recordedAt: string
}

export class GatewayError extends Error {
  // HTTP status from the gateway, or null when no response arrived.
  readonly status: number | null
  // Problems with individual fields from a 400, keyed by path, e.g. "site.name".
  readonly fields: Record<string, string>

  constructor(status: number | null, message?: string, fields: Record<string, string> = {}) {
    super(
      message ??
        (status === null
          ? 'The gateway could not be reached.'
          : `The gateway returned HTTP ${status}.`),
    )
    this.name = 'GatewayError'
    this.status = status
    this.fields = fields
  }
}

// The gateway answers 401 once the session has expired or was never there
// (F-04). The app listens for this and returns to the sign-in screen, keeping
// the URL so signing in again reopens the same screen.
export const SESSION_ENDED_EVENT = 'marsh:session-ended'
export function reportSessionEnded() {
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; data: T }> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      signal,
      // A form (with recordings) is sent as-is, so the browser sets its
      // multipart boundary; anything else as JSON.
      ...(body === undefined
        ? {}
        : body instanceof FormData
          ? { body }
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw error
    throw new GatewayError(null)
  }
  // Proxies, including Vite's dev proxy, answer 502/504 when the gateway is
  // down: the gateway itself sent nothing.
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (response.status === 401) reportSessionEnded()
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      error?: string
      fields?: Record<string, string>
    }
    throw new GatewayError(response.status, problem.error, problem.fields)
  }
  // Accepted operations can also return an empty body (e.g. transcription retry).
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  return { status: response.status, data: data as T }
}

// Every assessment, most recent site visit first (RV-10).
export async function listAssessments(signal?: AbortSignal): Promise<Assessment[]> {
  return (await request<Assessment[]>('GET', '/api/assessments', undefined, signal)).data
}

export type AssignableEngineer = {
  id: string
  name: string
  staffId: string
  jobTitle: string | null
}
export async function listAssignableEngineers(signal?: AbortSignal): Promise<AssignableEngineer[]> {
  return (
    await request<AssignableEngineer[]>('GET', '/api/assessments/engineers', undefined, signal)
  ).data
}

// Creates the assessment and its site; the server allocates the reference.
// Corrects an assessment's details (RV-10 AC10). The engineer and policy
// reference are not part of it: both stay as the assessment was created.
export type AssessmentDetails = Omit<NewAssessment, 'engineerId' | 'policyReference'>
export async function updateAssessment(
  reference: string,
  details: AssessmentDetails,
): Promise<void> {
  await request<void>('PUT', `/api/assessments/${encodeURIComponent(reference)}`, details)
}

export async function createAssessment(input: NewAssessment): Promise<Assessment> {
  return (await request<Assessment>('POST', '/api/assessments', input)).data
}

// Starts the assessment's capture session, or returns the one in progress.
// Archives an assessment (RV-10 AC8): a soft delete, open to its assigned engineer.
export async function archiveAssessment(reference: string): Promise<void> {
  await request<void>('POST', `/api/assessments/${encodeURIComponent(reference)}/archive`)
}

// Restores an archived assessment (RV-10 AC9) with the status it had.
export async function restoreAssessment(reference: string): Promise<void> {
  await request<void>('POST', `/api/assessments/${encodeURIComponent(reference)}/restore`)
}

export async function startCaptureSession(
  reference: string,
  signal?: AbortSignal,
): Promise<CaptureSession> {
  const { status, data } = await request<Omit<CaptureSession, 'resumed'>>(
    'POST',
    `/api/assessments/${encodeURIComponent(reference)}/capture-session`,
    undefined,
    signal,
  )
  return { ...data, resumed: status === 200 }
}

const observationsPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/observations`

// Saves one observation, with its note and recordings, to the assessment's
// active capture session. A null copeDimension leaves it uncategorised. The
// server stores each recording and starts its initial transcription.
export async function saveObservation(
  reference: string,
  details: {
    note?: string
    copeDimension: string | null
    severity: string
    locationId: string
    standard?: string
  },
  recordings: { name: string; audio: Blob }[],
): Promise<SavedObservation> {
  const form = new FormData()
  form.append('details', JSON.stringify(details))
  for (const r of recordings) form.append('recording', r.audio, r.name)
  return (await request<SavedObservation>('POST', observationsPath(reference), form)).data
}

// Every saved observation of the assessment, newest first.
export async function listObservations(
  reference: string,
  signal?: AbortSignal,
): Promise<SavedObservation[]> {
  return (await request<SavedObservation[]>('GET', observationsPath(reference), undefined, signal))
    .data
}

// Changes a saved observation's tags (CP-06). A tag left out stays as it is; a
// null copeDimension uncategorises it and a null standard removes it.
export async function updateObservationTags(
  id: string,
  tags: {
    copeDimension?: string | null
    severity?: string
    locationId?: string
    standard?: string | null
  },
): Promise<SavedObservation> {
  return (
    await request<SavedObservation>('PATCH', `/api/observations/${encodeURIComponent(id)}`, tags)
  ).data
}

// Starts a new transcription attempt for a failed recording.
export async function retryTranscription(observationId: string, recordingId: string) {
  await request<void>(
    'POST',
    `/api/observations/${encodeURIComponent(observationId)}/recordings/${encodeURIComponent(recordingId)}/transcription/retry`,
  )
}

const locationsPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/locations`

// The assessment's locations, in the order they were added.
export async function listLocations(
  reference: string,
  signal?: AbortSignal,
): Promise<SiteLocation[]> {
  return (await request<SiteLocation[]>('GET', locationsPath(reference), undefined, signal)).data
}

// Adds a location; 409 when the same name and floor is already listed.
export async function addLocation(
  reference: string,
  location: { name: string; floor?: string },
): Promise<SiteLocation> {
  return (await request<SiteLocation>('POST', locationsPath(reference), location)).data
}

// Removes a location; 409 while it has observations.
export async function removeLocation(reference: string, id: string): Promise<void> {
  await request<void>('DELETE', `${locationsPath(reference)}/${encodeURIComponent(id)}`)
}
