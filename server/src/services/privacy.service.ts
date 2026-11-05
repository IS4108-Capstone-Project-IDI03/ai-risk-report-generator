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

// A client's, site's or address's names: the current one first, as a
// placeholder restores to the first name, then those it had before it was
// corrected (CP-18), so notes written with an old name are still masked and
// read back with the current one.
function namesOf(current: string | null | undefined, former: string[] = []) {
  return [...(current ? [current] : []), ...former]
}
type NamedSite = Pick<ISite, 'name' | 'code' | 'address' | 'formerNames' | 'formerAddresses'>
function siteEntities(site: NamedSite): KnownEntity[] {
  const addresses = namesOf(site.address, site.formerAddresses)
  return [
    { type: 'SITE', names: [site.name, site.code, ...(site.formerNames ?? [])] },
    ...(addresses.length ? [{ type: 'ADDRESS' as const, names: addresses }] : []),
  ]
}

// The details an assessment's notes and drafts may name: its client, its site
// and the site's address, and the team's people. Sent with every masking call,
// so privacy-service finds them by name rather than leaving them to its model.
export async function knownEntities(reference: string): Promise<KnownEntity[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'site client')
    .populate<{ site: (ISite & { client?: IClient | null }) | null }>({
      path: 'site',
      select: 'name code address formerNames formerAddresses client',
      populate: { path: 'client', select: 'name formerNames' },
    })
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const site = assessment.site
  const users = await UserModel.find({ active: true }, 'name').lean()

  const entities: KnownEntity[] = []
  // An assessment from before CP-17 holds the client's name as typed.
  const client = site?.client
    ? namesOf(site.client.name, site.client.formerNames)
    : namesOf(assessment.client)
  if (client.length) entities.push({ type: 'CLIENT', names: client })
  if (site) entities.push(...siteEntities(site))
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

// Every client and site, removed ones included (CP-18): a removed site's name
// is still a client detail, so it stays masked.
async function readChatEntities(): Promise<KnownEntity[]> {
  const [clients, typed, sites, users] = await Promise.all([
    ClientModel.find({}, 'name formerNames').lean(),
    // Assessments from before CP-17 hold the client's name as typed.
    AssessmentModel.distinct('client', { client: { $nin: [null, ''] } }),
    SiteModel.find({}, 'name code address formerNames formerAddresses').lean(),
    UserModel.find({ active: true }, 'name').lean(),
  ])
  return [
    ...clients.map((c) => ({ type: 'CLIENT' as const, names: namesOf(c.name, c.formerNames) })),
    ...typed.map((name) => ({ type: 'CLIENT' as const, names: [name] })),
    ...sites.flatMap(siteEntities),
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

// The `privacy` field sent with each observation reading (PV-04): also whether
// S5 takes details the AI added out of its answer. Never with protection off.
export type ReadingPrivacy = Privacy & { check_answers: boolean }

export async function readingPrivacyFor(reference: string): Promise<ReadingPrivacy> {
  const privacy = await privacyFor(reference)
  return { ...privacy, check_answers: privacy.enabled && config.piiCheckAnswers }
}

// The `privacy` field the gateway sends with each chat message (PV-03).
export async function chatPrivacy(): Promise<Privacy> {
  if (config.piiProtection === 'off') return { enabled: false, known_entities: [] }
  return { enabled: true, known_entities: await chatKnownEntities() }
}

// The `privacy` field sent with a knowledge document's labelling and ingestion
// (PV-05). A past report has no assessment and may name any client, so it is
// chat's list, and organisations and buildings nobody listed are looked for too
// (`detect`, CP-23).
export type IngestionPrivacy = Privacy & { detect?: ('CLIENT' | 'SITE')[] }

export async function ingestionPrivacy(): Promise<IngestionPrivacy> {
  const privacy = await chatPrivacy()
  return privacy.enabled ? { ...privacy, detect: ['CLIENT', 'SITE'] } : privacy
}
