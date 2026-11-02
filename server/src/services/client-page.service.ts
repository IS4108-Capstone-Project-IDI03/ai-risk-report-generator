import { isValidObjectId } from 'mongoose'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import type { SessionUser } from './auth.service'
import { listAssessments, type AssessmentStatus } from './assessment.service'
import {
  ClientSiteError,
  clientRights,
  holdings,
  siteNameTaken,
  siteRights,
  stampDto,
  type Allowed,
  type StampDto,
} from './client.service'

// One of the engineer's visits to a site, as the client page lists it.
export type ClientVisitDto = {
  reference: string
  siteVisitDate: string | null
  status: AssessmentStatus
}

export type ClientPageSiteDto = {
  id: string
  code: string
  name: string
  address: string | null
  jurisdiction: string
  facilityType: string
  edited: StampDto | null
  // Set while it is removed; `removedWithClient` when it went with its client.
  removed: StampDto | null
  removedWithClient: boolean
  // A removed site whose name the client has since given another site: it
  // is restored only under a new name.
  nameTaken: boolean
  // How many assessments it has, archived or not: what a correction changes.
  assessments: number
  change: Allowed
  remove: Allowed
  restore: Allowed
  // The engineer's own visits, newest site visit first.
  visits: ClientVisitDto[]
}

export type ClientPageDto = {
  id: string
  name: string
  edited: StampDto | null
  // It has no listed site.
  removed: boolean
  rename: Allowed
  remove: Allowed
  // How many sites removed with it are still removed, and whether they can be
  // restored together.
  removedWithClient: number
  restore: Allowed
  // Its sites the engineer has an assessment at, in name order.
  sites: ClientPageSiteDto[]
}

// A client as the engineer sees it (CP-18): their sites at it, with their own
// visits there, and what they may change. Only someone with an assessment for
// the client may open it, and they see only their own work; their colleagues'
// assessments count towards what may be changed, but are never listed.
export async function getClientPage(id: string, user: SessionUser): Promise<ClientPageDto> {
  const client = isValidObjectId(id) ? await ClientModel.findById(id).lean() : null
  if (!client) throw new ClientSiteError('This client was not found.', 404)
  const sites = await SiteModel.find({ client: client._id })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean()
  const ids = new Set(sites.map((s) => String(s._id)))
  const mine = (await listAssessments(user)).filter((a) => ids.has(a.site.id))
  if (!mine.length) throw new ClientSiteError('You have no assessments for this client.', 403)
  const held = await holdings(
    sites.map((s) => s._id),
    user.id,
  )
  const visited = sites.filter((s) => mine.some((a) => a.site.id === String(s._id)))
  return {
    id: String(client._id),
    name: client.name,
    edited: stampDto(client.edited),
    ...clientRights(sites, held),
    sites: await Promise.all(
      visited.map(async (site) => ({
        id: String(site._id),
        code: site.code,
        name: site.name,
        address: site.address ?? null,
        jurisdiction: site.jurisdiction,
        facilityType: site.facilityType,
        edited: stampDto(site.edited),
        removed: stampDto(site.removed),
        removedWithClient: !!site.removed?.withClient,
        nameTaken: !!site.removed && (await siteNameTaken(client._id, site.name, site._id)),
        ...siteRights(site, held),
        visits: mine
          .filter((a) => a.site.id === String(site._id))
          .map((a) => ({
            reference: a.reference,
            siteVisitDate: a.siteVisitDate,
            status: a.status,
          })),
      })),
    ),
  }
}
