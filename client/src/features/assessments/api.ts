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
  // When its latest capture session started; null before capture starts.
  captureStartedAt: string | null
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
// Who changed or deleted an observation, and when (CP-08).
export type Stamp = { at: string; by: { id: string; name: string } }
export type SavedRecording = {
  id: string
  name: string
  contentType: string
  size: number
  url: string
  transcription: {
    status: TranscriptionStatus
    // As Whisper wrote it, kept even once corrected.
    transcript: string | null
    // The engineer's correction, which drafting uses (CP-08).
    correction: (Stamp & { text: string }) | null
    error: string | null
    attempts: number
  }
}
// A site photograph saved with an observation (CP-04); url opens the original.
export type SavedPhoto = {
  id: string
  name: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  url: string
}
// What the vision model proposes from an observation's photos (CP-05), for
// the engineer to review. Nothing reads them until an engineer asks; the
// reading then runs after that request returns, so it starts as
// 'interpreting'.
export type InterpretationStatus = 'interpreting' | 'interpreted' | 'failed'
export type SavedInterpretation = {
  status: InterpretationStatus
  description: string | null
  // A proposed category, which may differ from the observation's own.
  copeDimension: string | null
  hazardType: string | null
  // Why it failed, to show the engineer.
  error: string | null
  attempts: number
  // The model that wrote it.
  model: string | null
}
// A place on site the engineer records observations in.
export type SiteLocation = { id: string; name: string; floor: string | null }

// An observation saved on the server: any of a note (CP-02), recordings
// (CP-03) and photos (CP-04).
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
  photos: SavedPhoto[]
  // null until an engineer asks for its photos to be read (CP-05).
  interpretation: SavedInterpretation | null
  recordedAt: string
  // The latest change to its tags, note or a transcript (CP-08).
  edited: Stamp | null
  // Set while it is deleted (CP-08).
  deleted: Stamp | null
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
// Corrects an assessment's details (RV-10 AC10). The engineer, policy
// reference and standards are not part of it: they stay as created.
export type AssessmentDetails = Omit<NewAssessment, 'engineerId' | 'policyReference' | 'standards'>
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

// Saves one observation, with its note, recordings and photos, to the
// assessment's active capture session. A null copeDimension leaves it
// uncategorised. The server stores each file and starts each recording's
// initial transcription.
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
  photos: { name: string; image: Blob }[] = [],
): Promise<SavedObservation> {
  const form = new FormData()
  form.append('details', JSON.stringify(details))
  for (const r of recordings) form.append('recording', r.audio, r.name)
  for (const p of photos) form.append('photo', p.image, p.name)
  return (await request<SavedObservation>('POST', observationsPath(reference), form)).data
}

// Every saved observation of the assessment, newest first. Deleted ones are
// left out unless includeDeleted asks for them too (CP-08).
export async function listObservations(
  reference: string,
  signal?: AbortSignal,
  includeDeleted = false,
): Promise<SavedObservation[]> {
  const path = observationsPath(reference) + (includeDeleted ? '?include=deleted' : '')
  return (await request<SavedObservation[]>('GET', path, undefined, signal)).data
}

const observationPath = (id: string) => `/api/observations/${encodeURIComponent(id)}`

// Changes a saved observation's tags (CP-06) or note (CP-08). A field left out
// stays as it is; a null copeDimension uncategorises it, and a null standard
// or note removes it.
export async function updateObservation(
  id: string,
  changes: {
    copeDimension?: string | null
    severity?: string
    locationId?: string
    standard?: string | null
    note?: string | null
  },
): Promise<SavedObservation> {
  return (await request<SavedObservation>('PATCH', observationPath(id), changes)).data
}

// Corrects a finished transcript, keeping what Whisper wrote (CP-08).
export async function correctTranscript(
  id: string,
  recordingId: string,
  text: string,
): Promise<SavedObservation> {
  return (
    await request<SavedObservation>(
      'PUT',
      `${observationPath(id)}/recordings/${encodeURIComponent(recordingId)}/transcript`,
      { text },
    )
  ).data
}

// Deletes an observation, a soft delete it can be restored from (CP-08).
export async function deleteObservation(id: string): Promise<SavedObservation> {
  return (await request<SavedObservation>('DELETE', observationPath(id))).data
}

export async function restoreObservation(id: string): Promise<SavedObservation> {
  return (await request<SavedObservation>('POST', `${observationPath(id)}/restore`)).data
}

// Starts a new transcription attempt for a failed recording.
export async function retryTranscription(observationId: string, recordingId: string) {
  await request<void>(
    'POST',
    `/api/observations/${encodeURIComponent(observationId)}/recordings/${encodeURIComponent(recordingId)}/transcription/retry`,
  )
}

// Asks for an observation's photos to be read (CP-05): the first reading, or a
// new one after a failure. Saving never reads them.
export async function readPhotos(observationId: string) {
  await request<void>('POST', `${observationPath(observationId)}/interpretation`)
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

// One generated draft of a report section (GN-01). A statement cites
// observations (`O:<id>`) and standard passages (`C:<chunk id>`); `supported`
// is false when one of its citations does not resolve.
export type SectionDraft = {
  id: string
  sectionId: string
  title: string
  subsections: {
    heading: string
    kind: 'narrative' | 'fields' | 'table'
    statements: { text: string; citations: string[]; supported: boolean }[]
  }[]
  // The cited passages by citation ID: standards (`C:`) and any past report (`P:`).
  sources: Record<
    string,
    { text: string; doc_id?: string; headings?: string[]; page_start?: number; page_end?: number }
  >
  // Up to three questions for the engineer about gaps the evidence leaves.
  questions: string[]
  guardrail: { passed: boolean; unsupported_count: number }
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    template_version: string
    generated_at: string
  }
  createdAt: string
}

// What changed in a draft's evidence since it was written, by kind (CP-08).
export type ChangeCounts = { added: number; changed: number; removed: number }

export type ReportSection = {
  id: string
  title: string
  copeDimensions: string[]
  minObservations: number
  usableObservations: number
  latestDraft: SectionDraft | null
  // Observations added, changed or removed since the newest draft; redrafting
  // takes them in. The total, and each kind on its own (CP-08).
  changesSinceDraft: number
  changeCounts: ChangeCounts
}

const sectionsPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/sections`

// Sections 7-12, each with its usable evidence and newest draft.
export async function listSections(
  reference: string,
  signal?: AbortSignal,
): Promise<ReportSection[]> {
  return (await request<ReportSection[]>('GET', sectionsPath(reference), undefined, signal)).data
}

// A drafted Opportunity for Improvement for Section 3 (GN-05). Its value
// lists come from rag-service generation/ofi.json; `priority` is the Risk
// Assessment Matrix's value for likelihood x consequence, set in code.
export type Ofi = {
  id: string
  title: string
  category: string
  type: string
  description: string
  observation: string
  likelihood: string
  consequence: string
  priority: string
  effort: string
  // Observation ids it rests on, cited standards (`C:`) and the past-report OFI
  // (`P:`) it was adapted from, with those passages by ID.
  observations: string[]
  standards: string[]
  precedent: string | null
  sources: SectionDraft['sources']
  // The past report's title, from the knowledge base, or null if it has no record.
  precedentReport: string | null
  // Marsh's fixed fields, the same for a suggestion as once accepted.
  status: string
  issueDate: string | null
  // The configuration that drafted it (prompt, value-list version, model).
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    config_version: string
    generated_at: string
  }
}
// An accepted OFI as it reads in the report, numbered in report order.
export type AcceptedOfi = Ofi & { number: string }
export type OfiList = { suggestions: Ofi[]; accepted: AcceptedOfi[] }

const ofisPath = (reference: string) => `/api/assessments/${encodeURIComponent(reference)}/ofis`

export async function listOfis(reference: string, signal?: AbortSignal): Promise<OfiList> {
  return (await request<OfiList>('GET', ofisPath(reference), undefined, signal)).data
}

// Drafts OFI suggestions from the assessment's observations, replacing the
// unaccepted ones; accepted OFIs stay.
export async function draftOfis(reference: string): Promise<OfiList> {
  return (await request<OfiList>('POST', `${ofisPath(reference)}/draft`)).data
}

// Accepts one suggestion into the report.
export async function acceptOfi(reference: string, id: string): Promise<OfiList> {
  return (await request<OfiList>('POST', `${ofisPath(reference)}/${encodeURIComponent(id)}/accept`))
    .data
}

// Drafts one section from the assessment's observations; the gateway saves it.
export async function draftSection(reference: string, sectionId: string): Promise<SectionDraft> {
  return (
    await request<SectionDraft>(
      'POST',
      `${sectionsPath(reference)}/${encodeURIComponent(sectionId)}/draft`,
    )
  ).data
}

export type CompletionState = 'not_started' | 'partial' | 'complete'
export type ReviewState = 'not_drafted' | 'ai_draft' | 'needs_review'

export type SourcePassage = {
  id: string
  kind: 'standard' | 'precedent'
  text: string
  headings: string[]
  pageStart: number | null
  pageEnd: number | null
  documentId: string | null
  document: {
    title: string
    issuingBody: string
    sourceType: string
    edition: string | null
    effectiveDate: string
    withdrawnAt: string | null
    fileUrl: string
  } | null
}

export type FieldObservation = {
  id: string
  copeDimension: string
  note: string | null
  transcripts: string[]
  severity: string
  location: string | null
  standard: string | null
}

export type ReviewSection = {
  id: string
  title: string
  copeDimensions: string[]
  completion: { state: CompletionState; written: number; total: number; tables: number }
  review: {
    state: ReviewState
    unsupportedStatements: number
    withdrawnSources: number
    changesSinceDraft: number
    changeCounts: ChangeCounts
  }
  draft: Omit<SectionDraft, 'sources'> | null
  sources: Record<string, SourcePassage>
  observations: FieldObservation[]
}

export async function getReviewWorkspace(
  reference: string,
  signal?: AbortSignal,
): Promise<ReviewSection[]> {
  return (
    await request<{ sections: ReviewSection[] }>(
      'GET',
      `/api/assessments/${encodeURIComponent(reference)}/review`,
      undefined,
      signal,
    )
  ).data.sections
}
