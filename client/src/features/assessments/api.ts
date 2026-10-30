// Gateway (S2) calls for assessments. Requests go to /api, which Vite proxies
// to the gateway in development.

export type SiteDetails = {
  name: string
  address?: string
  jurisdiction: string
  facilityType: string
}
// A new assessment's client is a listed one (clientId) or a new name
// (client), and its site one of that client's (siteId) or a new one (site)
// (CP-17). On a listed site, copyLocations copies its latest visit's
// locations; the server copies them unless it is false.
export type NewAssessment = (
  { clientId: string; client?: never } | { client: string; clientId?: never }
) &
  (
    { siteId: string; copyLocations: boolean; site?: never } | { site: SiteDetails; siteId?: never }
  ) & {
    surveyType: string
    // YYYY-MM-DD, or '' when not scheduled.
    siteVisitDate?: string
    reportDueDate?: string
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
  // The client's name, read through its site (CP-17); clientId is null for a
  // site saved before clients, until it is migrated.
  client: string
  clientId: string | null
  surveyType: string
  siteVisitDate: string | null
  reportDueDate: string | null
  engineer: { id: string; name: string } | null
  status: AssessmentStatus
  // When its latest capture session started; null before capture starts.
  captureStartedAt: string | null
  createdAt: string
  // The site has another assessment that is not archived, so its details are
  // shared and can't be changed from this one (CP-17 AC8).
  siteShared: boolean
  site: {
    id: string
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
  // Who added it after the observation was saved (CP-08).
  added: Stamp | null
}
// A site photograph saved with an observation (CP-04); url opens the original.
export type SavedPhoto = {
  id: string
  name: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  url: string
  added: Stamp | null
}
// A photographed page of the engineer's handwritten notes (CP-19); url opens
// the original. Like a recording, its transcription runs after the save
// returns, so it starts as 'transcribing'.
export type SavedPage = {
  id: string
  name: string
  contentType: 'image/jpeg' | 'image/png'
  size: number
  url: string
  transcription: {
    status: TranscriptionStatus
    // The handwriting word for word; '' when the page has none.
    transcript: string | null
    // The words the model was unsure of, as [start, end) positions in transcript.
    uncertain: [number, number][]
    error: string | null
    attempts: number
    // The model that wrote it.
    model: string | null
  }
}
// What the model proposes from an observation (CP-05, CP-21), for the
// engineer to review. Nothing reads it until an engineer asks; the reading
// then runs after that request returns, so it starts as 'interpreting'.
export type InterpretationStatus = 'interpreting' | 'interpreted' | 'failed'
// One thing a reading read, by the label its evidence cites (CP-21).
export type ReadItemKind = 'note' | 'recording' | 'page' | 'photo'
export type ProposedCategory = {
  category: string
  // One sentence naming the items it rests on; null on a reading from before
  // CP-21, which gave none.
  reason: string | null
  evidence: {
    item: string
    // Words quoted from that item; null for a photo.
    quote: string | null
    // Whether the gateway found the quote in that item; null for a photo.
    verified: boolean | null
  }[]
}
// The parts of a proposal that can be read again one at a time (CP-21).
export type ReadingPart = 'categories' | 'description'
// The photos' part of a proposal: their description and hazard type, with
// where they stand, read again apart from the categories (CP-21).
export type SavedPhotoReading = {
  status: InterpretationStatus
  description: string | null
  hazardType: string | null
  error: string | null
  attempts: number
  model: string | null
  // The photos it describes, removed ones included.
  photoIds: string[]
  // Finished, but of photos other than those it has now.
  outOfDate: boolean
}
export type SavedInterpretation = {
  // Where the categories stand.
  status: InterpretationStatus
  // Null until its photos are first described.
  photos: SavedPhotoReading | null
  // The proposed categories, which may differ from the observation's own.
  categories: ProposedCategory[]
  // Why it failed, to show the engineer.
  error: string | null
  attempts: number
  // The model that wrote it.
  model: string | null
  // The photos it reads, removed ones included (CP-08).
  photoIds: string[]
  // Everything it reads; a recording or page with no transcript is left out.
  items: { label: string; kind: ReadItemKind; id: string | null; leftOut: boolean }[]
  // Finished, but of something other than what it holds now (CP-08, CP-21).
  outOfDate: boolean
}
// A place on site the engineer records observations in (CP-16): in a
// building, with an optional level, or elsewhere on site, with no building or
// level. One saved before CP-16 may have a level but no building.
export type SiteLocation = {
  id: string
  building: string | null
  floor: string | null
  name: string
}
// What the engineer gives for a new or changed location; blank ones are left out.
export type LocationDetails = { building?: string; floor?: string; name: string }

// An observation saved on the server: any of a note (CP-02), recordings
// (CP-03), photos (CP-04) and handwritten pages (CP-19).
export type SavedObservation = {
  id: string
  engineer: string
  // Its categories in C-O-P-E order; null when not categorised yet.
  copeDimensions: string[] | null
  standard: string | null
  severity: string
  // null only if the location is no longer listed.
  location: SiteLocation | null
  // Exactly as the engineer wrote it.
  note: string | null
  // Those not removed: its evidence.
  recordings: SavedRecording[]
  photos: SavedPhoto[]
  // Its handwritten pages (CP-19); the gateway always sends them, but older
  // stand-ins for a saved observation have none.
  pages?: SavedPage[]
  // Removed ones, kept to restore (CP-08).
  removedRecordings: (SavedRecording & { removed: Stamp })[]
  removedPhotos: (SavedPhoto & { removed: Stamp })[]
  // null until an engineer asks for its photos to be read (CP-05), and while
  // no photo is left.
  interpretation: SavedInterpretation | null
  recordedAt: string
  // The latest change to its tags, note, a transcript, or its recordings and
  // photos (CP-08).
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

/** Returns a gateway call's status and parsed body; a 401 also ends the session (F-04). */
export async function request<T>(
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

// Corrects an assessment's details (RV-10 AC10). The engineer, client and
// site stay as created (CP-17 AC8); the site's details can be corrected while
// it is not shared.
export type AssessmentDetails = {
  site: SiteDetails
  surveyType: string
  siteVisitDate?: string
  reportDueDate?: string
}
export async function updateAssessment(
  reference: string,
  details: AssessmentDetails,
): Promise<void> {
  await request<void>('PUT', `/api/assessments/${encodeURIComponent(reference)}`, details)
}

// Creates the assessment, adding its client and site when they are new; the
// server allocates the reference.
export async function createAssessment(input: NewAssessment): Promise<Assessment> {
  return (await request<Assessment>('POST', '/api/assessments', input)).data
}

// A client the firm surveys for, whoever added it (CP-17).
export type Client = { id: string; name: string; sites: number }
export async function listClients(signal?: AbortSignal): Promise<Client[]> {
  return (await request<Client[]>('GET', '/api/clients', undefined, signal)).data
}

// One of a client's sites, with its latest visit not archived: what a new
// assessment there would copy its locations from.
export type ClientSite = {
  id: string
  code: string
  name: string
  address: string | null
  jurisdiction: string
  facilityType: string
  latest: {
    reference: string
    siteVisitDate: string | null
    locations: number
    buildings: number
  } | null
}
export async function listClientSites(
  clientId: string,
  signal?: AbortSignal,
): Promise<ClientSite[]> {
  return (
    await request<ClientSite[]>(
      'GET',
      `/api/clients/${encodeURIComponent(clientId)}/sites`,
      undefined,
      signal,
    )
  ).data
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

// Saves one observation, with its note, recordings, photos and handwritten
// pages, to the assessment's active capture session. Null copeDimensions leave
// it uncategorised. The server stores each file and starts each recording's
// and page's initial transcription.
export async function saveObservation(
  reference: string,
  details: {
    note?: string
    copeDimensions: string[] | null
    severity: string
    locationId: string
    standard?: string
  },
  recordings: { name: string; audio: Blob }[],
  photos: { name: string; image: Blob }[] = [],
  pages: { name: string; image: Blob }[] = [],
): Promise<SavedObservation> {
  const form = new FormData()
  form.append('details', JSON.stringify(details))
  for (const r of recordings) form.append('recording', r.audio, r.name)
  for (const p of photos) form.append('photo', p.image, p.name)
  for (const p of pages) form.append('page', p.image, p.name)
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
// stays as it is; null copeDimensions uncategorise it, and a null standard
// or note removes it.
export async function updateObservation(
  id: string,
  changes: {
    copeDimensions?: string[] | null
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

// Adds recordings and photos to a saved observation (CP-08). The server
// stores each file and starts each recording's transcription; it reads no
// photo until asked.
export async function addObservationMedia(
  id: string,
  recordings: { name: string; audio: Blob }[],
  photos: { name: string; image: Blob }[],
): Promise<SavedObservation> {
  const form = new FormData()
  for (const r of recordings) form.append('recording', r.audio, r.name)
  for (const p of photos) form.append('photo', p.image, p.name)
  return (await request<SavedObservation>('POST', `${observationPath(id)}/media`, form)).data
}

// Removes a recording or photo from an observation, a soft removal it can be
// restored from (CP-08), and restores one.
export type MediaKind = 'recordings' | 'photos'
const mediaPath = (id: string, kind: MediaKind, itemId: string) =>
  `${observationPath(id)}/${kind}/${encodeURIComponent(itemId)}`
export async function removeMedia(
  id: string,
  kind: MediaKind,
  itemId: string,
): Promise<SavedObservation> {
  return (await request<SavedObservation>('DELETE', mediaPath(id, kind, itemId))).data
}
export async function restoreMedia(
  id: string,
  kind: MediaKind,
  itemId: string,
): Promise<SavedObservation> {
  return (await request<SavedObservation>('POST', `${mediaPath(id, kind, itemId)}/restore`)).data
}

// Starts a new transcription attempt for a failed recording.
export async function retryTranscription(observationId: string, recordingId: string) {
  await request<void>(
    'POST',
    `/api/observations/${encodeURIComponent(observationId)}/recordings/${encodeURIComponent(recordingId)}/transcription/retry`,
  )
}

// Starts a new transcription attempt for a failed handwritten page (CP-19).
export async function retryPageTranscription(observationId: string, pageId: string) {
  await request<void>(
    'POST',
    `${observationPath(observationId)}/pages/${encodeURIComponent(pageId)}/transcription/retry`,
  )
}

// Transcribes a page again although its last transcription succeeded (CP-20);
// the assessment's assigned engineer only, as it replaces the page's text.
export async function retranscribePage(
  observationId: string,
  pageId: string,
): Promise<SavedObservation> {
  return (
    await request<SavedObservation>(
      'POST',
      `${observationPath(observationId)}/pages/${encodeURIComponent(pageId)}/retranscribe`,
    )
  ).data
}

// Asks for an observation to be read (CP-05, CP-21): both parts the first
// time, or one part again (`part`), whenever the engineer asks. Saving never
// reads it.
export async function readObservation(observationId: string, part?: ReadingPart) {
  await request<void>(
    'POST',
    `${observationPath(observationId)}/interpretation`,
    part ? { part } : undefined,
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

// Adds a location; 409 when the same name, level and building is already listed.
export async function addLocation(
  reference: string,
  location: LocationDetails,
): Promise<SiteLocation> {
  return (await request<SiteLocation>('POST', locationsPath(reference), location)).data
}

// Changes a location's building, level or name (CP-16); 403 for anyone but the
// assigned engineer, 409 once archived or when another location has them.
export async function editLocation(
  reference: string,
  id: string,
  location: LocationDetails,
): Promise<SiteLocation> {
  return (
    await request<SiteLocation>(
      'PATCH',
      `${locationsPath(reference)}/${encodeURIComponent(id)}`,
      location,
    )
  ).data
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
    // What the engineer asked a regenerated draft to change (RV-02), or null.
    instruction?: string | null
  }
  createdAt: string
}

// What changed in a draft's evidence since it was written, by kind (CP-08), and
// `figures` (GN-03): 1, present only when Section 4 or 5's figures changed.
export type ChangeCounts = { added: number; changed: number; removed: number; figures?: number }

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
  // Sections 4 and 5 (GN-03): why the section cannot be drafted yet, else null.
  inputsMissing: string | null
}

const sectionsPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/sections`

// Sections 4-12, each with its usable evidence and newest draft.
export async function listSections(
  reference: string,
  signal?: AbortSignal,
): Promise<ReportSection[]> {
  return (await request<ReportSection[]>('GET', sectionsPath(reference), undefined, signal)).data
}

// A drafted Opportunity for Improvement for Section 3 (GN-05). Its value
// lists come from rag-service generation/ofi.json; `priority` is the Risk
// Assessment Matrix's value for likelihood x consequence, set in code.
export type OfiLossValues = {
  current: { pd: number | null; bi: number | null }
  after: { pd: number | null; bi: number | null }
}
export type Ofi = {
  lossExpectancy?: {
    current: OfiLossValues['current'] & { total: number | null }
    after: OfiLossValues['after'] & { total: number | null }
  }
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

export async function saveOfiLossValues(
  reference: string,
  id: string,
  values: OfiLossValues,
): Promise<OfiList> {
  return (
    await request<OfiList>(
      'PUT',
      `${ofisPath(reference)}/${encodeURIComponent(id)}/loss-values`,
      values,
    )
  ).data
}

// A knowledge-base standard that applies to the site (CP-30 AC1).
export type ScopeStandard = {
  id: string
  title: string
  issuingBody: string | null
  standardNumber: string | null
  edition: string | null
  sourceType: string | null
  // When it was added to the knowledge base (ISO).
  uploadedAt: string
}
export type ChecklistItem = {
  id: string
  // A report section ('7') or 'hazards'.
  area: string
  subsection: string | null
  // Only 'standard' and 'hazard' are written by the model (AC8).
  origin: 'template' | 'standard' | 'hazard' | 'hazard_list'
  hazard: string | null
  text: string
  fields: string[]
  COPE_dimension: string[]
  citations: { ref: string; quote: string; quoteFound: boolean }[]
  flags: 'uncited'[]
}
// A cited passage as the checklist was given it: its text and Chroma labels.
export type ChecklistSource = {
  text: string
  doc_id?: string
  headings?: string[]
  page_start?: number
  page_end?: number
}
export type Checklist = {
  id: string
  facilityType: string
  jurisdiction: string
  standards: Omit<ScopeStandard, 'issuingBody' | 'uploadedAt'>[]
  items: ChecklistItem[]
  areas: { id: string; title: string }[]
  hazards: { id: string; name: string; standards: string[]; inScope: string[] }[]
  sources: Record<string, ChecklistSource>
  provenance: {
    provider: string
    model: string | null
    effort: string
    prompt_version: string
    checklist_version: string
    template_version: string
    generated_at: string
  }
  createdAt: string
}
// The site's scope, the standards that apply to it now, and the latest checklist.
export type ChecklistView = {
  scope: { facilityType: string; jurisdiction: string }
  standards: ScopeStandard[]
  checklist: Checklist | null
}

const checklistPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/checklist`

export async function getChecklist(reference: string, signal?: AbortSignal) {
  return (await request<ChecklistView>('GET', checklistPath(reference), undefined, signal)).data
}

// Generates a checklist from the standards kept ticked (AC2); the gateway saves
// it as the latest and keeps the earlier ones.
export async function generateChecklist(reference: string, standardIds: string[]) {
  return (await request<ChecklistView>('POST', checklistPath(reference), { standardIds })).data
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
// `needs_review` comes from the draft's own checks and wins over the rest;
// then `edited` (RV-08): the engineer changed or wrote the section in the
// document editor; otherwise the engineer's decisions (RV-02) decide:
// `ai_draft` while every finding is pending, `in_review` once some are
// decided, `reviewed` once none is pending.
export type ReviewState =
  'not_drafted' | 'ai_draft' | 'in_review' | 'reviewed' | 'edited' | 'needs_review'

// A generated finding's review decision (RV-02). Rejected findings are out of
// the draft, kept in the review history.
export type FindingState = 'pending' | 'accepted' | 'edited' | 'rejected'
export type FindingCounts = { total: number } & Record<FindingState, number>

// One finding: a statement of the draft with the engineer's decision on it.
export type ReviewStatement = {
  // The text now: the engineer's wording once edited.
  text: string
  // What the draft says.
  generatedText: string
  citations: string[]
  supported: boolean
  // Drafted citations deleted in the document editor (RV-08): the finding is
  // unsupported while any is missing.
  citationsRemoved?: string[]
  // at and by are null while no decision has been made.
  review: { state: FindingState; at: string | null; by: { id: string; name: string } | null }
}
export type ReviewDraft = Omit<SectionDraft, 'sources' | 'subsections'> & {
  subsections: {
    heading: string
    kind: 'narrative' | 'fields' | 'table'
    statements: ReviewStatement[]
  }[]
}

// One entry of the immutable review audit log (RV-02).
export type ReviewAction =
  | 'accept'
  | 'edit'
  | 'reject'
  | 'restore'
  | 'regenerate'
  | 'accept_replacement'
  | 'discard_replacement'
export type ReviewHistoryEntry = {
  id: string
  // The draft decided on: the saved one, a replacement, or an earlier draft.
  draftId: string
  action: ReviewAction
  // `<subsection>.<statement>` of the finding; null for a whole draft.
  finding: string | null
  heading: string | null
  // The text before the decision, and the engineer's text for an edit.
  before: string | null
  after: string | null
  citations: string[]
  // Its citations after an edit in the document editor (RV-08), else null.
  citationsAfter?: string[] | null
  instruction: string | null
  // Accepted by Bulk accept.
  bulk: boolean
  // Made in the document editor (RV-08): an edit, or a reject for a finding
  // deleted there. Also set on the entries a version restore made (RV-06).
  inDocument?: boolean
  // Made by restoring an earlier version (RV-06): what was restored,
  // `version:<n>` or `draft:<id>`; null or absent otherwise.
  restoredFrom?: string | null
  by: { id: string; name: string }
  at: string
}

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
  // Its categories in C-O-P-E order, one or more.
  copeDimensions: string[]
  note: string | null
  transcripts: string[]
  // Its transcribed handwritten pages (CP-19); absent from a gateway before them.
  handwriting?: string[]
  severity: string
  location: string | null
  standard: string | null
}

// A regenerated draft waiting to be accepted or discarded (RV-02).
export type ReviewReplacement = {
  draft: ReviewDraft
  sources: Record<string, SourcePassage>
  observations: FieldObservation[]
  instruction: string | null
  requestedBy: { id: string; name: string } | null
  requestedAt: string
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
    // Changed or written in the document editor (RV-08), shown as Edited by
    // you beside Needs review.
    editedInDocument?: boolean
  }
  // The saved draft's findings by state (RV-02).
  findings: FindingCounts
  // The saved draft: the section's content.
  draft: ReviewDraft | null
  sources: Record<string, SourcePassage>
  observations: FieldObservation[]
  replacement: ReviewReplacement | null
  // The section's review audit log, newest first.
  history: ReviewHistoryEntry[]
  // Its newest version from the document editor (RV-08), or null.
  document?: SectionVersion | null
}

export type ReviewWorkspace = {
  sections: ReviewSection[]
  // What the engineer wrote into Sections 1, 2 and 3 and Appendix A in the
  // document editor (RV-08): each one's newest version, or null.
  parts?: Record<ReportPartId, SectionVersion | null>
  // Every saved draft's findings by state: the review summary (RV-02).
  summary: FindingCounts
  // When the gateway read it, to keep the newest of overlapping responses.
  asOf: string
}

const reviewPath = (reference: string) => `/api/assessments/${encodeURIComponent(reference)}`
const sectionPath = (reference: string, sectionId: string) =>
  `${sectionsPath(reference)}/${encodeURIComponent(sectionId)}`

export async function getReviewWorkspace(
  reference: string,
  signal?: AbortSignal,
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>('GET', `${reviewPath(reference)}/review`, undefined, signal)
  ).data
}

// Review decisions (RV-02). Each names the saved draft the engineer was looking
// at, and returns the review workspace as it now stands. Only the assigned
// engineer may make them.
export type FindingAction = 'accept' | 'reject' | 'restore'
export async function decideFinding(
  reference: string,
  sectionId: string,
  draftId: string,
  finding: string,
  action: FindingAction,
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>(
      'POST',
      `${sectionPath(reference, sectionId)}/findings/${encodeURIComponent(finding)}/${action}`,
      { draftId },
    )
  ).data
}

// Saves the engineer's wording of a finding; its citations stay with it.
export async function editFinding(
  reference: string,
  sectionId: string,
  draftId: string,
  finding: string,
  text: string,
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>(
      'PUT',
      `${sectionPath(reference, sectionId)}/findings/${encodeURIComponent(finding)}`,
      { draftId, text },
    )
  ).data
}

// Accepts every pending finding of the section's saved draft.
export async function bulkAccept(
  reference: string,
  sectionId: string,
  draftId: string,
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>('POST', `${sectionPath(reference, sectionId)}/bulk-accept`, {
      draftId,
    })
  ).data
}

// Drafts the section again as a replacement for its saved draft, with what
// the engineer wants changed, if anything.
export async function regenerateSection(
  reference: string,
  sectionId: string,
  instruction: string,
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>('POST', `${sectionPath(reference, sectionId)}/regenerate`, {
      instruction,
    })
  ).data
}

// Accepts the waiting replacement as the section's content, or discards it.
export async function decideReplacement(
  reference: string,
  sectionId: string,
  draftId: string,
  action: 'accept' | 'discard',
): Promise<ReviewWorkspace> {
  return (
    await request<ReviewWorkspace>(
      'POST',
      `${sectionPath(reference, sectionId)}/replacement/${action}`,
      { draftId },
    )
  ).data
}

// The report as one document (RV-08). A section's text as the document editor
// saves it: what comes before its first subsection (all of it when it has
// none), then each of its draft's subsections by heading. A paragraph taken
// from the draft names its finding (`<subsection>.<statement>`); a citation
// marker names its source as a statement's citations do.
export type DocumentMark = 'bold' | 'italic' | 'underline'
export type DocumentInline =
  { type: 'text'; text: string; marks?: DocumentMark[] } | { type: 'cite'; id: string }
export type DocumentParagraph = {
  type: 'paragraph'
  finding?: string | null
  content: DocumentInline[]
}
// A sub-heading: one the engineer added, or a finding they set as one.
export type DocumentHeading = {
  type: 'heading'
  finding?: string | null
  content: DocumentInline[]
}
export type DocumentBlock =
  | DocumentParagraph
  | DocumentHeading
  | { type: 'bulletList' | 'orderedList'; items: DocumentParagraph[] }
export type SectionDocument = {
  intro: DocumentBlock[]
  subsections: { heading: string; blocks: DocumentBlock[] }[]
}
// The parts of the report outside sections 4-12.
export type ReportPartId = '1' | '2' | '3' | 'A'
// A saved version of a section. `current` is false once the section has been
// drafted again since, so its finding keys name an earlier draft.
export type SectionVersion = {
  version: number
  draftId: string | null
  document: SectionDocument
  // What it restored (RV-06), `version:<n>` or `draft:<id>`; null for a save.
  restoredFrom?: string | null
  savedAt: string
  savedBy: { id: string; name: string }
  current: boolean
}

// Saves one section as the engineer wrote it, as a new version built on its
// newest version (`baseVersion`, 0 for none) and its saved draft (`draftId`).
// Only the assigned engineer may; a newer save or draft is refused (409).
export async function saveSectionDocument(
  reference: string,
  sectionId: string,
  body: { baseVersion: number; draftId: string | null; document: SectionDocument },
): Promise<Omit<SectionVersion, 'current'>> {
  return (
    await request<Omit<SectionVersion, 'current'>>(
      'PUT',
      `${sectionPath(reference, sectionId)}/document`,
      body,
    )
  ).data
}

// A section's version history (RV-06): every AI draft it has had and every
// version saved in the document editor, oldest first. `id` is what a restore
// names: `version:<n>` or `draft:<id>`.
export type VersionOrigin = 'drafted' | 'redrafted' | 'replacement' | 'saved' | 'restored'
export type SectionHistoryEntry = {
  id: string
  kind: 'version' | 'draft'
  // A saved version's number; null for a draft.
  version: number | null
  // The draft its finding keys name, or null for text written with none.
  draftId: string | null
  // Made on the section's saved draft, so its findings are the section's now.
  onSavedDraft: boolean
  origin: VersionOrigin
  restoredFrom: string | null
  // The section's text as it then stood.
  document: SectionDocument
  // When it became the section's text, and who saved, drafted or accepted it.
  at: string
  by: { id: string; name: string } | null
  // The model that wrote a draft; null for a version.
  model: string | null
}
export type SectionHistory = {
  sectionId: string
  entries: SectionHistoryEntry[]
  // What a restore is built on: the newest version (0 for none) and the saved draft.
  latestVersion: number
  savedDraftId: string | null
}

export async function getSectionHistory(
  reference: string,
  sectionId: string,
  signal?: AbortSignal,
): Promise<SectionHistory> {
  return (
    await request<SectionHistory>(
      'GET',
      `${sectionPath(reference, sectionId)}/versions`,
      undefined,
      signal,
    )
  ).data
}

// Restores one entry of a section's version history as its text: a new
// version, built on the newest version and saved draft the engineer saw.
// Only the assigned engineer may; a newer save or draft is refused (409).
// Returns the new version and the review workspace as it now stands.
export async function restoreSectionVersion(
  reference: string,
  sectionId: string,
  body: { baseVersion: number; draftId: string | null; from: string },
): Promise<{ version: Omit<SectionVersion, 'current'>; workspace: ReviewWorkspace }> {
  return (
    await request<{ version: Omit<SectionVersion, 'current'>; workspace: ReviewWorkspace }>(
      'POST',
      `${sectionPath(reference, sectionId)}/versions/restore`,
      body,
    )
  ).data
}

// Sections 1 and 2 (GN-07): Purpose and Scope, assembled by the gateway from
// the assessment's details, and the Executive Summary drafted from Sections
// 3-12, with the sections it still needs (AC3) or that changed since (AC4).
export type SectionRef = { id: string; title: string }
export type Summary = {
  // Marsh's Purpose and Scope: paragraphs, and the list of visit activities as an array.
  purposeAndScope: (string | string[])[]
  executiveSummary: {
    draft: SectionDraft | null
    missing: SectionRef[]
    staleSections: SectionRef[]
  }
}

const summaryPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/summary`

export async function getSummary(reference: string, signal?: AbortSignal): Promise<Summary> {
  return (await request<Summary>('GET', summaryPath(reference), undefined, signal)).data
}

// Drafts the Executive Summary; the gateway saves it as Section 2.
export async function draftSummary(reference: string): Promise<SectionDraft> {
  return (await request<SectionDraft>('POST', `${summaryPath(reference)}/draft`)).data
}

// Appendix A (GN-07): every photo of the report, and the chosen ones in order
// with their captions.
export type AppendixPhoto = {
  photoId: string
  observationId: string
  name: string
  url: string
  location: string | null
  category: string | null
  note: string | null
  selected: boolean
}
export type AppendixList = {
  selected: (Omit<AppendixPhoto, 'selected'> & { caption: string })[]
  available: AppendixPhoto[]
}

const appendixPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/appendix`

export async function getAppendix(reference: string, signal?: AbortSignal): Promise<AppendixList> {
  return (await request<AppendixList>('GET', appendixPath(reference), undefined, signal)).data
}

// Replaces the appendix with this ordered list.
export async function saveAppendix(
  reference: string,
  photos: { photoId: string; caption: string }[],
): Promise<AppendixList> {
  return (await request<AppendixList>('PUT', appendixPath(reference), { photos })).data
}

// Section 4 Risk Quality Ratings (GN-03): the engineer's seven category scores,
// and the location score and rating the gateway computes from them. A side is
// null until all seven of its scores are entered.
export type CategoryScore = { category: string; current: number | null; potential: number | null }
export type Rated = { score: number; rating: string; band: string }
// RQR Score Benchmarking's other bars (GN-12), typed by the engineer: 0-100 or null.
export type Benchmarks = { client: number | null; peerGroup: number | null }
// A figure the model proposed (GN-03 addendum): why, and the observations (`O:<id>`)
// or sections (`S:<id>`) it rests on. Null figures were out of range: left to the engineer.
export type ProposedWhy = { reason: string; citations: string[] }
export type FigureProposal<T> = T & {
  provenance: { model: string; prompt_version: string; generated_at: string }
  proposedAt: string
}
export type RiskQuality = {
  // Shown until the engineer enters a score; the result never uses it (AC10, AC13).
  proposal?: FigureProposal<{ categories: (CategoryScore & ProposedWhy)[] }> | null
  benchmarks?: Benchmarks
  categories: CategoryScore[]
  result: {
    current: Rated | null
    potential: Rated | null
    basis: {
      weights: { category: string; weight: number }[]
      legend: string[]
      rulesVersion: string
    }
  }
  updatedAt: string | null
}

const riskQualityPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/risk-quality`

export async function getRiskQuality(reference: string, signal?: AbortSignal) {
  return (await request<RiskQuality>('GET', riskQualityPath(reference), undefined, signal)).data
}

export async function saveRiskQuality(
  reference: string,
  input: { categories: CategoryScore[]; benchmarks: Benchmarks },
) {
  return (await request<RiskQuality>('PUT', riskQualityPath(reference), input)).data
}

// Asks the model to propose the scores (GN-03 addendum). A paid call.
export async function proposeRiskQuality(reference: string) {
  return (await request<RiskQuality>('POST', `${riskQualityPath(reference)}/propose`)).data
}

// Section 5 Loss Estimates (GN-03): the site values, each level's % damage and
// outage months, and the losses the gateway computes from them. A loss is null
// while any input it needs is not entered.
export type ValueRow = { key: string; item: string; value: number | null }
export type LossLevel = 'I' | 'II' | 'III'
export type LossInputs = {
  currency: string | null
  dateOfValues: string | null
  indemnityMonths: number | null
  pd: ValueRow[]
  te: ValueRow[]
  levels: {
    level: LossLevel
    pd: { key: string; percent: number | null }[]
    damageRows?: (ValueRow & { percent: number | null })[]
    te: { key: string; months: number | null; percent: number | null }[]
  }[]
}
type LossRow = {
  key: string
  item: string
  value: number | null
  percent: number | null
  loss: number | null
}
export type ProposedLevel = {
  level: LossLevel
  damage: ({ item: string; percent: number | null } & ProposedWhy)[]
  te: ({ item: string; months: number | null; percent: number | null } & ProposedWhy)[]
}
export type LossEstimates = {
  // As RiskQuality's: per-level figures only, shown until a level figure is entered.
  proposal?: FigureProposal<{ levels: ProposedLevel[] }> | null
  inputs: LossInputs
  result: {
    values: { pd: number | null; te: number | null; tiv: number | null }
    levels: {
      level: LossLevel
      pd: LossRow[]
      te: (LossRow & { months: number | null })[]
      pdLoss: number | null
      teLoss: number | null
      total: number | null
    }[]
    rulesVersion: string
  }
  updatedAt: string | null
}

const lossEstimatesPath = (reference: string) =>
  `/api/assessments/${encodeURIComponent(reference)}/loss-estimates`

export async function getLossEstimates(reference: string, signal?: AbortSignal) {
  return (await request<LossEstimates>('GET', lossEstimatesPath(reference), undefined, signal)).data
}

export async function saveLossEstimates(reference: string, inputs: LossInputs) {
  return (await request<LossEstimates>('PUT', lossEstimatesPath(reference), inputs)).data
}

// Asks the model to propose each level's % and months (GN-03 addendum). A paid call.
export async function proposeLossEstimates(reference: string) {
  return (await request<LossEstimates>('POST', `${lossEstimatesPath(reference)}/propose`)).data
}
