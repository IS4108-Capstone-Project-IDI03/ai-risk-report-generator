// PV-09: the knowledge admin's Always masked and Never masked lists. Called by
// routes/settings.routes.ts; privacy.service.ts reads the lists for every masking request.
// Every change is logged in settings_log as `privacyWords`.
import { isValidObjectId } from 'mongoose'
import { config } from '../config'
import { AppSettingsModel } from '../models/app-settings.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { SettingsLogModel } from '../models/settings-log.model'
import {
  PRIVACY_KINDS,
  PRIVACY_LISTS,
  PrivacyWordModel,
  wordKey,
  type PrivacyKind,
  type PrivacyList,
} from '../models/privacy-word.model'
import type { SessionUser } from './auth.service'
import { readChatEntities } from './privacy.service'
import { SettingsInputError, log, metadata } from './settings.service'

type Input = { list?: unknown; word?: unknown; reason?: unknown; kind?: unknown }

/** Adds a word to one list and logs it. Throws SettingsInputError when it can't be added. */
export async function addPrivacyWord(by: SessionUser, input: Input) {
  const list = input.list as PrivacyList
  if (!PRIVACY_LISTS.includes(list)) throw new SettingsInputError('Choose Always or Never masked.')
  const word = typeof input.word === 'string' ? input.word.trim() : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!word) throw new SettingsInputError('Enter a word.')
  if (!reason) throw new SettingsInputError('Say why this word is on the list.')
  const kind = list === 'always' ? (input.kind as PrivacyKind) : null
  if (list === 'always' && !PRIVACY_KINDS.includes(kind as PrivacyKind)) {
    throw new SettingsInputError('Choose what the name is: a client, site, address or person.')
  }
  if (list === 'never') await refuseRecordedName(word)
  await defaultsSeeded()
  const saved = await PrivacyWordModel.create({
    list,
    word,
    key: wordKey(word),
    kind,
    reason,
    source: 'admin',
    addedBy: { id: by.id, name: by.name },
    at: new Date(),
    metadata: metadata('settings'),
  }).catch((error) => {
    // The unique index on list and key: two admins adding one word at once, or a repeat.
    if (error?.code === 11000) {
      throw new SettingsInputError(`"${word}" is already on this list.`, 409)
    }
    throw error
  })
  await log(by, 'privacyWords', null, { list, word, kind, reason })
  forgetPrivacyWords()
  return saved
}

/** Removes one word from its list and logs it. Throws SettingsInputError 404 when it isn't on one. */
export async function removePrivacyWord(by: SessionUser, id: string) {
  const removed = isValidObjectId(id) ? await PrivacyWordModel.findByIdAndDelete(id).lean() : null
  if (!removed) throw new SettingsInputError('That word is not on either list.', 404)
  const { list, word, kind, reason } = removed
  await log(by, 'privacyWords', { list, word, kind, reason }, null)
  forgetPrivacyWords()
}

/** Both lists as Settings shows them, with the last 20 changes, newest first. */
export async function privacyWordsView() {
  await defaultsSeeded()
  const [rows, history] = await Promise.all([
    PrivacyWordModel.find({}).sort({ key: 1 }).lean(),
    // _id breaks a tie: an add and its Undo can land in the same millisecond.
    SettingsLogModel.find({ setting: 'privacyWords' }).sort({ at: -1, _id: -1 }).limit(20).lean(),
  ])
  const shown = rows.map((r) => ({
    id: String(r._id),
    list: r.list,
    word: r.word,
    kind: r.kind,
    reason: r.reason,
    source: r.source,
    addedBy: r.addedBy,
    at: r.at,
  }))
  return {
    protectionOn: config.piiProtection !== 'off',
    always: shown.filter((r) => r.list === 'always'),
    never: shown.filter((r) => r.list === 'never'),
    history: history.map((h) => ({ at: h.at, by: h.by, before: h.before, after: h.after })),
  }
}

// A tag's kind: [PERSON_2] and [PHONE 3] as written by privacy-service, client_1 as stored.
const TAG = /^\[?\s*([A-Za-z]+)[ _]\d+\s*\]?$/

/**
 * Every word past reports had masked at ingestion (AC10), once each: its kind and how many
 * reports hold it, so an admin can spot one masked by mistake. Never a tag, a document or its
 * title: the mapping itself stays out of the browser (DECISIONS 2026-11-22).
 */
export async function maskedInReports() {
  await defaultsSeeded()
  const [documents, never] = await Promise.all([
    KnowledgeDocumentModel.aggregate<{ pairs: { k: string; v: unknown }[] }>([
      { $match: { privacyMapping: { $type: 'object' } } },
      { $project: { _id: 0, pairs: { $objectToArray: '$privacyMapping' } } },
    ]),
    PrivacyWordModel.find({ list: 'never' }, 'key').lean(),
  ])
  const allowed = new Set(never.map((w) => w.key))
  const words = new Map<string, { word: string; kind: string; reports: number }>()
  for (const { pairs } of documents) {
    const inThisReport = new Set<string>()
    for (const { k, v } of pairs) {
      if (typeof v !== 'string' || !wordKey(v)) continue
      const key = wordKey(v)
      if (inThisReport.has(key)) continue
      inThisReport.add(key)
      const seen = words.get(key)
      if (seen) seen.reports += 1
      else
        words.set(key, { word: v, kind: (TAG.exec(k)?.[1] ?? 'OTHER').toUpperCase(), reports: 1 })
    }
  }
  return {
    words: [...words.entries()].map(([key, w]) => ({ ...w, neverMasked: allowed.has(key) })),
  }
}

// Masking wins (AC4): a recorded client, site, address or user, under any of its names, or a
// name on Always masked, can't be put on Never masked. Read fresh, not from chat's cache, so a
// client recorded a moment ago is refused too.
async function refuseRecordedName(word: string) {
  const key = wordKey(word)
  for (const entity of await readChatEntities()) {
    const recorded = entity.names.find((name) => wordKey(name) === key)
    if (recorded) {
      throw new SettingsInputError(
        `"${recorded}" is a recorded ${entity.type.toLowerCase()} name, so it is always masked.`,
        409,
      )
    }
  }
  if (await PrivacyWordModel.exists({ list: 'always', key })) {
    throw new SettingsInputError(`"${word}" is on Always masked, so it can't be never masked.`, 409)
  }
}

export type PrivacyWordLists = {
  always: { type: PrivacyKind; names: string[] }[]
  // Undefined until the defaults are seeded: privacy-service then uses its own file.
  never: string[] | undefined
}

// How long the lists are reused: every masking request needs them. A change is used once the
// minute is up (AC8), as for chat's known names.
const TTL_MS = 60_000
let cached: { at: number; lists: Promise<PrivacyWordLists> } | null = null

/** The lists as privacy-service takes them, read at most once a minute. */
export function privacyWordLists(): Promise<PrivacyWordLists> {
  if (!cached || Date.now() - cached.at >= TTL_MS) {
    const read = { at: Date.now(), lists: readLists() }
    // A failed read isn't kept, so the next request tries again.
    read.lists.catch(() => {
      if (cached === read) cached = null
    })
    cached = read
  }
  return cached.lists
}

// An admin's own change is used at once in this process; other processes follow within the
// minute.
function forgetPrivacyWords() {
  cached = null
}

async function readLists(): Promise<PrivacyWordLists> {
  // Until the defaults are seeded, Never masked is left out of requests, so privacy-service uses
  // its own file as before PV-09: an admin's list without the defaults would mask "Marsh".
  const seeded = await seedPrivacyWords().then(
    () => true,
    (error: unknown) => {
      console.error('Seeding the privacy word lists failed; privacy-service uses its file:', error)
      return false
    },
  )
  const rows = await PrivacyWordModel.find({}, 'list word kind').lean()
  return {
    always: rows
      .filter((r) => r.list === 'always')
      .map((r) => ({ type: r.kind as PrivacyKind, names: [r.word] })),
    never: seeded ? rows.filter((r) => r.list === 'never').map((r) => r.word) : undefined,
  }
}

/**
 * Seeds Never masked from privacy-service's allow-list file, once ever (AC5): each word with its
 * heading as the reason. A default the admin removes later is not seeded again. Called at start,
 * and before the lists are read or changed. Returns whether it seeded just now. Throws when
 * privacy-service can't be reached.
 */
export async function seedPrivacyWords(): Promise<boolean> {
  if (await AppSettingsModel.exists({ key: 'global', privacyWordsSeeded: true })) return false
  const res = await fetch(`${config.privacyServiceUrl}/allow-list`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`privacy-service answered ${res.status} for its allow list`)
  const { words } = (await res.json()) as { words: { word: string; reason: string }[] }
  const at = new Date()
  const keys = new Set<string>()
  const defaults = words.flatMap(({ word, reason }) => {
    const key = wordKey(word)
    if (!key || keys.has(key)) return [] // a word under two headings keeps the first
    keys.add(key)
    return [
      {
        list: 'never',
        word,
        key,
        kind: null,
        reason,
        source: 'default',
        addedBy: null,
        at,
        metadata: metadata('settings'),
      },
    ]
  })
  // Two processes seeding at once: the unique index keeps one of each.
  await PrivacyWordModel.insertMany(defaults, { ordered: false }).catch((error) => {
    if (error?.code !== 11000) throw error
  })
  await AppSettingsModel.updateOne(
    { key: 'global' },
    { $set: { privacyWordsSeeded: true }, $setOnInsert: { metadata: metadata('settings') } },
    { upsert: true },
  )
  return true
}

// Before the admin reads or changes a list: the defaults must be there, or a word they add
// would be sent without them.
async function defaultsSeeded() {
  try {
    // Requests may have cached the lists without the defaults: they use them from now on.
    if (await seedPrivacyWords()) forgetPrivacyWords()
  } catch {
    throw new SettingsInputError(
      "The shipped Never masked words couldn't be loaded because the privacy service didn't answer. Try again shortly.",
      503,
    )
  }
}
