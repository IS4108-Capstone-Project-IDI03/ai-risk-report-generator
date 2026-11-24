// F-12: the walkthrough record, what an account has played, skipped or declined, kept in
// `user_settings.walkthroughs`. Called by settings.service.ts (saving) and routes/auth.routes.ts
// (returned with the signed-in user). Calls practice.service.ts for the practice reference.
// The practice service keeps `practiceRemoved` in the same object, so every write here
// touches one dotted path and never replaces `walkthroughs` as a whole.
import { UserSettingsModel } from '../models/user-settings.model'
import type { SessionUser } from './auth.service'
import { metadata, SettingsInputError } from './settings.service'

const STATES = ['played', 'skipped', 'declined'] as const
type State = (typeof STATES)[number]

export type WalkthroughRecord = {
  welcomeAt: string | null
  offers: boolean
  seen: Record<string, { state: State; at: string }>
  otherWay: string[]
  counts: Record<string, number>
  practice: string | null
}

// What PATCH /api/settings/me accepts under `walkthroughs`.
export type WalkthroughPatch = {
  welcome?: true
  offers?: boolean
  seen?: Record<string, State>
  otherWay?: string[]
  count?: string
  clear?: true
}

const ID = /^[a-z0-9-]{1,40}$/
const MAX_IDS = 100
const KEYS = ['welcome', 'offers', 'seen', 'otherWay', 'count', 'clear']

const fail = (message: string): never => {
  throw new SettingsInputError(message)
}
const checkId = (id: unknown): string =>
  typeof id === 'string' && ID.test(id)
    ? id
    : fail('A walkthrough id is 1 to 40 lowercase letters, digits or dashes.')

/** Returns the patch if it is valid; throws SettingsInputError on any bad value, so nothing is saved. */
export function checkWalkthroughPatch(input: unknown): WalkthroughPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('The walkthrough settings must be an object.')
  }
  const body = input as Record<string, unknown>
  const unknown = Object.keys(body).find((k) => !KEYS.includes(k))
  if (unknown) fail(`"${unknown}" is not a walkthrough setting.`)
  if (!Object.keys(body).length) fail('Nothing to save.')
  if ('welcome' in body && body.welcome !== true) fail('Welcome can only be set to true.')
  if ('clear' in body && body.clear !== true) fail('Clear can only be set to true.')
  if ('offers' in body && typeof body.offers !== 'boolean') fail('Offers must be true or false.')
  if ('count' in body) checkId(body.count)
  let ids = 0
  if ('seen' in body) {
    const seen = body.seen
    if (!seen || typeof seen !== 'object' || Array.isArray(seen)) fail('Seen must be an object.')
    for (const [id, state] of Object.entries(seen as object)) {
      checkId(id)
      if (!(STATES as readonly unknown[]).includes(state)) {
        fail('A walkthrough is played, skipped or declined.')
      }
      ids += 1
    }
  }
  if ('otherWay' in body) {
    if (!Array.isArray(body.otherWay)) fail('The other-way list must be a list of ids.')
    ;(body.otherWay as unknown[]).forEach(checkId)
    ids += (body.otherWay as unknown[]).length
  }
  // Without this cap one call could write an unbounded number of keys into the user's document.
  if (ids > MAX_IDS) fail(`At most ${MAX_IDS} walkthrough ids can be saved at once.`)
  return body as WalkthroughPatch
}

// How the record is stored: times are Dates, returned as ISO text.
type Saved = {
  welcomeAt?: Date
  offers?: boolean
  seen?: Record<string, { state: State; at: Date }>
  otherWay?: string[]
  counts?: Record<string, number>
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null)

/** Returns this account's walkthrough record with its live practice reference. Never throws: on any error it returns the defaults with no practice, so sign-in still works. */
export async function walkthroughRecordFor(user: SessionUser): Promise<WalkthroughRecord> {
  const defaults: WalkthroughRecord = {
    welcomeAt: null,
    offers: true,
    seen: {},
    otherWay: [],
    counts: {},
    practice: null,
  }
  try {
    // a. Practice first, as it may make the record's document; ensurePractice never throws.
    // Loaded here, not at the top: settings.service imports this file, and practice.service
    // reaches settings.service again through drafting. A top-level import would load one of
    // them half-built (generation.service then crashed on an undefined list at start-up).
    const { ensurePractice } = await import('./practice/practice.service')
    const practice = await ensurePractice(user)
    const saved = (await UserSettingsModel.findOne({ user: user.id }, 'walkthroughs').lean())
      ?.walkthroughs as Saved | undefined
    const seen: WalkthroughRecord['seen'] = {}
    for (const [id, entry] of Object.entries(saved?.seen ?? {})) {
      seen[id] = { state: entry.state, at: iso(entry.at) ?? '' }
    }
    return {
      welcomeAt: iso(saved?.welcomeAt),
      offers: saved?.offers !== false,
      seen,
      otherWay: saved?.otherWay ?? [],
      counts: saved?.counts ?? {},
      practice,
    }
  } catch (error) {
    console.error(`Could not read the walkthrough record of ${user.id}:`, error)
    return defaults
  }
}

/** Saves one patch to this account's record; returns nothing. Throws SettingsInputError on a bad value, saving nothing. */
export async function saveWalkthroughs(userId: string, input: unknown): Promise<void> {
  const patch = checkWalkthroughPatch(input)
  const at = new Date()
  const set: Record<string, unknown> = {}
  if (patch.welcome) set['walkthroughs.welcomeAt'] = at
  if (patch.offers !== undefined) set['walkthroughs.offers'] = patch.offers
  for (const [id, state] of Object.entries(patch.seen ?? {})) {
    set[`walkthroughs.seen.${id}`] = { state, at }
  }
  const upsert = { $setOnInsert: { user: userId, metadata: metadata('settings') } }

  // "Offer them all again" runs first and on its own, so anything saved with it is kept:
  // $unset and $set on the same path in one update is an error. Only these four are
  // unset, never `offers` or `practiceRemoved`.
  if (patch.clear) {
    const unset = Object.fromEntries(
      ['welcomeAt', 'seen', 'otherWay', 'counts'].map((k) => [`walkthroughs.${k}`, '']),
    )
    await UserSettingsModel.updateOne(
      { user: userId },
      { $unset: unset, ...upsert },
      { upsert: true },
    )
  }
  const inc = patch.count ? { [`walkthroughs.counts.${patch.count}`]: 1 } : null
  const add = patch.otherWay?.length ? { 'walkthroughs.otherWay': { $each: patch.otherWay } } : null
  if (!Object.keys(set).length && !inc && !add) return
  await UserSettingsModel.updateOne(
    { user: userId },
    {
      ...(Object.keys(set).length && { $set: set }),
      ...(inc && { $inc: inc }),
      ...(add && { $addToSet: add }),
      ...upsert,
    },
    { upsert: true },
  )
}
