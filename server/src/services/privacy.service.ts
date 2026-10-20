import { AssessmentModel } from '../models/assessment.model'
import type { IClient } from '../models/client.model'
import type { ISite } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { AssessmentNotFoundError } from './capture-session.service'

// A detail privacy-service masks wherever it appears (PV-01): one client, site,
// address or person, under every name it goes by. Its placeholder restores to
// the first name.
export type KnownEntity = { type: 'CLIENT' | 'SITE' | 'ADDRESS' | 'PERSON'; names: string[] }

// The details an assessment's notes and drafts may name: its client, its site
// and the site's address, and the team's people. Sent with every masking call,
// so privacy-service finds them by name rather than leaving them to its model.
export async function knownEntities(reference: string): Promise<KnownEntity[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'site client')
    .populate<{ site: (ISite & { client?: IClient | null }) | null }>({
      path: 'site',
      select: 'name code address client',
      populate: { path: 'client', select: 'name' },
    })
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const site = assessment.site
  const users = await UserModel.find({ active: true }, 'name').lean()

  const entities: KnownEntity[] = []
  // An assessment from before CP-17 holds the client's name as typed.
  const client = site?.client?.name ?? assessment.client
  if (client) entities.push({ type: 'CLIENT', names: [client] })
  if (site) entities.push({ type: 'SITE', names: [site.name, site.code] })
  if (site?.address) entities.push({ type: 'ADDRESS', names: [site.address] })
  for (const { name } of users) entities.push({ type: 'PERSON', names: [name] })
  return entities
}
