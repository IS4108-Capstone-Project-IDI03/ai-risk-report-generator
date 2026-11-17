// S-01: one engineer's own values for the personal settings, one document per user in
// `user_settings`. A value missing here means "use the admin's default". Written by
// settings.service.ts.
import { Schema, model } from 'mongoose'
import { metadataSchema, type PersonalValues, type SettingsMetadata } from './app-settings.model'

export interface IUserSettings {
  user: string
  values: PersonalValues
  metadata: SettingsMetadata
}

const userSettingsSchema = new Schema<IUserSettings>(
  {
    user: { type: String, required: true, unique: true },
    values: { type: Schema.Types.Mixed, default: {} },
    metadata: metadataSchema,
  },
  { collection: 'user_settings', minimize: false },
)

export const UserSettingsModel = model<IUserSettings>('UserSettings', userSettingsSchema)
