import { config } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel, type IClient } from '../models/client.model'
import { SiteModel, type ISite } from '../models/site.model'
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

// How long chat reuses the list it read. Every chat message needs it; a client
// added since is masked once the minute is up.
const CHAT_ENTITIES_TTL_MS = 60_000
let chatEntities: { at: number; entities: Promise<KnownEntity[]> } | null = null

// The details a chat message may name (PV-03). Chat has no assessment, so it
// is every client, site and address, and the team's people.
export function chatKnownEntities(): Promise<KnownEntity[]> {
  if (!chatEntities || Date.now() - chatEntities.at >= CHAT_ENTITIES_TTL_MS) {
    const read = { at: Date.now(), entities: readChatEntities() }
    // A failed read isn't kept, so the next message tries again.
    read.entities.catch(() => {
      if (chatEntities === read) chatEntities = null
    })
    chatEntities = read
  }
  return chatEntities.entities
}

async function readChatEntities(): Promise<KnownEntity[]> {
  const [clients, typed, sites, users] = await Promise.all([
    ClientModel.find({}, 'name').lean(),
    // Assessments from before CP-17 hold the client's name as typed.
    AssessmentModel.distinct('client', { client: { $nin: [null, ''] } }),
    SiteModel.find({}, 'name code address').lean(),
    UserModel.find({ active: true }, 'name').lean(),
  ])
  return [
    ...clients.map(({ name }) => ({ type: 'CLIENT' as const, names: [name] })),
    ...typed.map((name) => ({ type: 'CLIENT' as const, names: [name] })),
    ...sites.map(({ name, code }) => ({ type: 'SITE' as const, names: [name, code] })),
    ...sites.flatMap(({ address }) =>
      address ? [{ type: 'ADDRESS' as const, names: [address] }] : [],
    ),
    ...users.map(({ name }) => ({ type: 'PERSON' as const, names: [name] })),
  ]
}

// The `privacy` field the gateway sends with each drafting request (PV-02, the
// epic's Rule 1): rag masks client details only when it is enabled. The Python
// services never read PII_PROTECTION themselves.
export type Privacy = { enabled: boolean; known_entities: KnownEntity[] }

export async function privacyFor(reference: string): Promise<Privacy> {
  if (config.piiProtection === 'off') return { enabled: false, known_entities: [] }
  return { enabled: true, known_entities: await knownEntities(reference) }
}

// The `privacy` field the gateway sends with each chat message (PV-03).
export async function chatPrivacy(): Promise<Privacy> {
  if (config.piiProtection === 'off') return { enabled: false, known_entities: [] }
  return { enabled: true, known_entities: await chatKnownEntities() }
}
