// Gateway (S2) calls for managing a client and its sites (CP-18).
import { request, type Allowed, type AssessmentStatus } from '../assessments/api'

export type { Allowed }

// Who changed or removed something, and when.
export type Stamp = { at: string; by: { id: string; name: string } }

// One of the engineer's visits to a site, newest site visit first.
export type ClientVisit = {
  reference: string
  siteVisitDate: string | null
  status: AssessmentStatus
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
  edited: Stamp | null
  // It has no listed site.
  removed: boolean
  rename: Allowed
  remove: Allowed
  // Sites removed with it and still removed, and whether they can come back together.
  removedWithClient: number
  restore: Allowed
  sites: ClientPageSite[]
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

// Removes a site, and restores one, under a new name when its own was taken.
export async function removeSite(id: string): Promise<void> {
  await request<void>('POST', `${sitePath(id)}/remove`)
}
export async function restoreSite(id: string, name?: string): Promise<void> {
  await request<void>('POST', `${sitePath(id)}/restore`, name ? { name } : undefined)
}
