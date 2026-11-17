// Gateway (S2) calls for managing a client and its sites (CP-18).
import { GatewayError, request, type Allowed, type AssessmentStatus } from '../assessments/api'
import type { Priority, Stage } from '../marshbot/types'

export type { Allowed }

// Who changed or removed something, and when.
export type Stamp = { at: string; by: { id: string; name: string } }

// One of the engineer's visits to a site, newest site visit first.
export type ClientVisit = {
  reference: string
  siteVisitDate: string | null
  // First survey, Resurvey or Follow-up visit (CP-23).
  surveyType: string
  reportDueDate: string | null
  status: AssessmentStatus
  // AS-06: where it stands and why it is urgent; absent from older answers.
  stage?: Stage
  priority?: Priority | null
}

export type ClientPageSite = {
  id: string
  code: string
  name: string
  address: string | null
  jurisdiction: string
  facilityType: string
  edited: Stamp | null
  // Set while it is removed; `removedWithClient` when it went with its client.
  removed: Stamp | null
  removedWithClient: boolean
  // Removed, and the client has since given another site its name: it is
  // restored only under a new one.
  nameTaken: boolean
  // How many assessments it has, archived or not: what a correction changes.
  assessments: number
  change: Allowed
  remove: Allowed
  restore: Allowed
  visits: ClientVisit[]
}

// A client as the signed-in engineer sees it: their sites at it, with their
// own visits, and what they may change. Colleagues' assessments count towards
// what may change, but are never listed.
export type ClientPage = {
  id: string
  name: string
  // The client's division, when recorded (CP-23).
  division?: string | null
  edited: Stamp | null
  // It has no listed site.
  removed: boolean
  rename: Allowed
  remove: Allowed
  // Sites removed with it and still removed, and whether they can come back together.
  removedWithClient: number
  restore: Allowed
  sites: ClientPageSite[]
  // People named as site contacts on the client's assessments (CP-23).
  contacts?: { name: string; role: string | null; site: string }[]
  // How many documents it has, for the Documents tab's count (CP-23).
  documents?: number
}

// A site's details as they are corrected.
export type SiteFields = {
  name: string
  address: string
  jurisdiction: string
  facilityType: string
}

const clientPath = (id: string) => `/api/clients/${encodeURIComponent(id)}`
const sitePath = (id: string) => `/api/sites/${encodeURIComponent(id)}`

/** Returns the client's page. */
export async function getClientPage(id: string, signal?: AbortSignal): Promise<ClientPage> {
  return (await request<ClientPage>('GET', clientPath(id), undefined, signal)).data
}

// Renames the client for all its assessments.
export async function renameClient(id: string, name: string): Promise<void> {
  await request<void>('PUT', clientPath(id), { name })
}

// Removes all the client's listed sites as one removal, and restores them.
export async function removeClient(id: string): Promise<void> {
  await request<void>('POST', `${clientPath(id)}/remove`)
}
export async function restoreClient(
  id: string,
): Promise<{ restored: number; nameTaken: string[] }> {
  return (
    await request<{ restored: number; nameTaken: string[] }>('POST', `${clientPath(id)}/restore`)
  ).data
}

// Corrects a site for every assessment at it.
export async function correctSite(id: string, fields: SiteFields): Promise<void> {
  await request<void>('PUT', sitePath(id), fields)
}

// A site's location and block pins (CP-26).
type Point = { lat: number; lng: number }
export type SiteMap = { coordinates: Point | null; pins: (Point & { name: string })[] }
// One change to them, null to remove: the gateway takes one at a time, so
// engineers pinning different blocks can't erase each other's pins.
export type SiteMapChange = { coordinates: Point | null } | { block: string; point: Point | null }
export async function changeSiteMap(id: string, change: SiteMapChange): Promise<void> {
  await request<void>('PUT', `${sitePath(id)}/map`, change)
}

// Removes a site, and restores one, under a new name when its own was taken.
export async function removeSite(id: string): Promise<void> {
  await request<void>('POST', `${sitePath(id)}/remove`)
}
export async function restoreSite(id: string, name?: string): Promise<void> {
  await request<void>('POST', `${sitePath(id)}/restore`, name ? { name } : undefined)
}

// A file kept for a client (CP-23): where it belongs, and who added it.
export type DocumentPlacement =
  | { kind: 'client' }
  | { kind: 'site'; siteId: string; siteName: string }
  | {
      kind: 'assessment'
      assessmentId: string
      reference: string
      siteId: string
      siteName: string
    }
export type ClientDocument = {
  id: string
  name: string
  contentType: string
  size: number
  placement: DocumentPlacement
  // What the Tag pill shows: Whole client, a site's name or "RPT-… · site".
  tag: string
  // Added from client documents, or uploaded on the client page.
  origin: 'intake' | 'upload'
  originLabel: string
  uploadedAt: string
  uploadedBy: { id: string; name: string }
}

// A tag a document can take, as the gateway lists it: send `placement` back as-is.
export type DocumentTag = { placement: Placement; label: string }
export type Placement =
  | { kind: 'client' }
  | { kind: 'site'; siteId: string }
  | { kind: 'assessment'; assessmentId: string }

// What an upload did with each file: kept (with its record) or refused (why).
export type UploadedFile =
  | { name: string; status: 'kept'; document: ClientDocument }
  | { name: string; status: 'refused'; reason: string }

/** Returns the client's documents, oldest first. */
export async function getClientDocuments(
  clientId: string,
  signal?: AbortSignal,
): Promise<ClientDocument[]> {
  return (
    await request<ClientDocument[]>('GET', `${clientPath(clientId)}/documents`, undefined, signal)
  ).data
}

// The original file, for a link that opens in a new tab.
/** Returns the URL of a document's original file. */
export const documentFileUrl = (id: string) =>
  `/api/client-documents/${encodeURIComponent(id)}/file`

// Same file with ?download=1: the server answers "attachment", so the browser saves it.
export const documentDownloadUrl = (id: string) => `${documentFileUrl(id)}?download=1`

/** Uploads files to a client's documents (to `placement`, the whole client when left out); returns what became of each file. */
export async function uploadClientDocuments(
  clientId: string,
  files: File[],
  placement?: Placement,
): Promise<UploadedFile[]> {
  const form = new FormData()
  for (const file of files) form.append('file', file)
  if (placement) form.append('placement', JSON.stringify(placement))
  try {
    return (
      await request<{ files: UploadedFile[] }>('POST', `${clientPath(clientId)}/documents`, form)
    ).data.files
  } catch (error: unknown) {
    // 400: none was kept; the gateway still says why for each.
    const detail = error instanceof GatewayError ? error.detail.files : undefined
    if (Array.isArray(detail)) return detail as UploadedFile[]
    throw error
  }
}

/** Returns the tags a client's documents can take. */
export async function getDocumentTags(clientId: string, signal?: AbortSignal) {
  return (
    await request<DocumentTag[]>('GET', `${clientPath(clientId)}/document-tags`, undefined, signal)
  ).data
}

/** Moves a document to another tag; returns the updated document. */
export async function retagClientDocument(id: string, placement: Placement) {
  return (
    await request<ClientDocument>('PATCH', `/api/client-documents/${encodeURIComponent(id)}`, {
      placement,
    })
  ).data
}

/** Deletes a client document; returns nothing. */
export async function deleteClientDocument(id: string): Promise<void> {
  await request<void>('DELETE', `/api/client-documents/${encodeURIComponent(id)}`)
}

// What the clients list adds to the work list (CP-23): each client's division and what the
// engineer may do with it (the server's reason when not).
export type ClientListInfo = { division: string | null; rename: Allowed; remove: Allowed }

export async function listClientInfo(signal?: AbortSignal): Promise<Map<string, ClientListInfo>> {
  const list = (
    await request<({ id: string; division?: string | null } & Omit<ClientListInfo, 'division'>)[]>(
      'GET',
      '/api/clients',
      undefined,
      signal,
    )
  ).data
  return new Map(
    list.map((c) => [c.id, { division: c.division ?? null, rename: c.rename, remove: c.remove }]),
  )
}

// ---- Insights (CP-29): what the client's sites add up to, and its written summary ----

export type InsightTone = 'danger' | 'warn' | 'good' | 'neutral'

// One category's observations at a site; `category` null is not yet categorised.
export type InsightCell = { category: string | null; count: number; critical: number; high: number }

// One of a site's assessments that has observations.
export type InsightVisit = {
  reference: string
  siteVisitDate: string | null
  surveyType: string
  observations: number
  criticalHigh: number
  ofis: number
  score: number | null
  rating: string | null
}

export type InsightSite = {
  id: string
  name: string
  facilityType: string
  jurisdiction: string
  // The assessment its figures come from: the latest with observations.
  reference: string
  siteVisitDate: string | null
  status: AssessmentStatus
  observations: number
  critical: number
  high: number
  uncategorised: number
  cells: InsightCell[]
  ofis: { accepted: number; priority1: number; priority2: number }
  // Null until all seven Section 4 scores are entered.
  rating: { score: number; rating: string } | null
  reasons: { text: string; tone: InsightTone }[]
  // Oldest first.
  visits: InsightVisit[]
  change: 'improved' | 'worse' | 'same' | null
}

export type InsightFinding = {
  kind: 'category' | 'worse' | 'improved' | 'severe'
  tone: InsightTone
  title: string
  detail: string
  siteId: string | null
  category: string | null
  share: { count: number; total: number } | null
  change: { from: number; to: number; period: string | null } | null
}

export type InsightSource = {
  n: number
  kind: 'observation' | 'figure'
  title: string
  meta: string | null
  quote: string
  observationId: string | null
  reference: string | null
}

// The summary the model drafted from the figures and the engineer's observations.
export type InsightSummary = {
  id: string
  statements: { text: string; citations: number[] }[]
  missing: string | null
  confidence: 'high' | 'medium' | 'low'
  sources: InsightSource[]
  basis: { observations: number; ofis: number; ratings: number }
  writtenAt: string
  // The observations or figures changed since it was written.
  outOfDate: boolean
}

export type ClientInsights = {
  rulesVersion: string
  // No site has an observation yet.
  empty: boolean
  totals: {
    sites: number
    assessments: number
    observations: number
    uncategorised: number
    critical: number
    high: number
    ofisAccepted: number
    ofisPriority12: number
    reportsLate: number
    latest: { site: string; days: number } | null
  }
  byCategory: InsightCell[]
  // Worst first.
  sites: InsightSite[]
  findings: InsightFinding[]
  summary: InsightSummary | null
  canSummarise: boolean
}

/** Returns the client's insights, with the user's latest summary. */
export async function getClientInsights(id: string, signal?: AbortSignal): Promise<ClientInsights> {
  return (await request<ClientInsights>('GET', `${clientPath(id)}/insights`, undefined, signal))
    .data
}

/** Writes a new summary of the client's insights; returns it. */
export async function writeInsightSummary(id: string): Promise<InsightSummary> {
  return (await request<InsightSummary>('POST', `${clientPath(id)}/insights/summary`)).data
}
