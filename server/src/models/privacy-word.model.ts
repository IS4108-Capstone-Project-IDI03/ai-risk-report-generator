// PV-09: the knowledge admin's privacy word lists, one document per word in `privacy_words`.
// - `always`: names masked wherever client text goes to an external AI, beyond the clients,
//   sites and users the app holds. Sent to privacy-service as known entities of their `kind`.
// - `never`: words privacy-service leaves as written, seeded from its allow_list.json.
// Written by privacy-words.service.ts; every change is logged in settings_log. It is not a
// knowledge document: its metadata fields are null (docs/areas/database.md).
import { Schema, model } from 'mongoose'
import { metadataSchema, type SettingsMetadata } from './app-settings.model'

export const PRIVACY_LISTS = ['always', 'never'] as const
export type PrivacyList = (typeof PRIVACY_LISTS)[number]
export const PRIVACY_KINDS = ['CLIENT', 'SITE', 'ADDRESS', 'PERSON'] as const
export type PrivacyKind = (typeof PRIVACY_KINDS)[number]

export interface IPrivacyWord {
  list: PrivacyList
  word: string
  // Lower case, spaces collapsed, as privacy-service compares: one entry per list per key.
  key: string
  // Always masked only: the placeholder's kind ([CLIENT_n], [SITE_n]...). Null on Never masked.
  kind: PrivacyKind | null
  reason: string
  // `default`: seeded from allow_list.json; `admin`: added in Settings.
  source: 'default' | 'admin'
  addedBy: { id: string; name: string } | null
  at: Date
  metadata: SettingsMetadata
}

/** The key a word is compared by, as privacy-service normalises it. */
export function wordKey(word: string): string {
  return word.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

const privacyWordSchema = new Schema<IPrivacyWord>(
  {
    list: { type: String, enum: PRIVACY_LISTS, required: true },
    word: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    kind: { type: String, enum: [...PRIVACY_KINDS, null], default: null },
    reason: { type: String, required: true, trim: true },
    source: { type: String, enum: ['default', 'admin'], required: true },
    addedBy: {
      type: new Schema({ id: String, name: String }, { _id: false }),
      default: null,
    },
    at: { type: Date, required: true },
    metadata: metadataSchema,
  },
  { collection: 'privacy_words', minimize: false },
)
privacyWordSchema.index({ list: 1, key: 1 }, { unique: true })

export const PrivacyWordModel = model<IPrivacyWord>('PrivacyWord', privacyWordSchema)
