// CP-35: one engineer's own note-taking settings (shorthand codes and glossary), one
// document per user in `user_settings`. A code missing here uses the default in code
// (settings.service.ts). Written by settings.service.ts `savePersonal`.
import { Schema, model } from 'mongoose'
import { metadataSchema, type SettingsMetadata } from './app-settings.model'

export type NoteCodes = { fact?: string; info_request?: string; recommendation?: string }
export type GlossaryEntry = { term: string; meaning: string }

export interface IUserSettings {
  user: string
  noteCodes?: NoteCodes
  glossary?: GlossaryEntry[]
  // F-12: the walkthrough record (what this account has played, skipped or declined, and
  // whether offers are on). Read and written by walkthrough-record.service.ts; the practice
  // service keeps `practiceRemoved` here too.
  walkthroughs?: Record<string, unknown>
  metadata: SettingsMetadata
}

const userSettingsSchema = new Schema<IUserSettings>(
  {
    user: { type: String, required: true, unique: true },
    noteCodes: { type: Schema.Types.Mixed },
    glossary: { type: [{ term: String, meaning: String, _id: false }], default: undefined },
    walkthroughs: { type: Schema.Types.Mixed },
    metadata: metadataSchema,
  },
  { collection: 'user_settings', minimize: false },
)

export const UserSettingsModel = model<IUserSettings>('UserSettings', userSettingsSchema)
