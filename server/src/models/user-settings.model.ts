// One person's own settings, one document per user in `user_settings`: today only the
// walkthrough record (F-12). CP-36 removed the note codes and glossary that CP-35 kept here.
// Written by settings.service.ts `savePersonal` and the walkthrough and practice services.
import { Schema, model } from 'mongoose'
import { metadataSchema, type SettingsMetadata } from './app-settings.model'

export interface IUserSettings {
  user: string
  // F-12: the walkthrough record (what this account has played, skipped or declined, and
  // whether offers are on). Read and written by walkthrough-record.service.ts; the practice
  // service keeps `practiceRemoved` here too.
  walkthroughs?: Record<string, unknown>
  metadata: SettingsMetadata
}

const userSettingsSchema = new Schema<IUserSettings>(
  {
    user: { type: String, required: true, unique: true },
    walkthroughs: { type: Schema.Types.Mixed },
    metadata: metadataSchema,
  },
  { collection: 'user_settings', minimize: false },
)

export const UserSettingsModel = model<IUserSettings>('UserSettings', userSettingsSchema)
