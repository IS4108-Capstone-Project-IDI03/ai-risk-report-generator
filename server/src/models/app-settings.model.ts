// S-01: the admin's settings for everyone, one document in `app_settings`: which model each
// AI task uses, and the QA strictness. Written by
// settings.service.ts; every change is also logged in settings_log. Metadata nulls follow
// docs/areas/database.md (a document with no assessment stores null for those fields).
import { Schema, model } from 'mongoose'
import { DEFAULT_TIER_ORDER, TIER_IDS, type TierId } from '../services/source-tiers'

export const QA_STRICTNESS = ['strict', 'standard', 'lenient'] as const
export type QaStrictness = (typeof QA_STRICTNESS)[number]

export interface IAppSettings {
  key: 'global'
  // Task name to the chosen option id ("provider:model"); a task missing here uses its `.env` default.
  models: Record<string, string>
  qaStrictness: QaStrictness
  // RT-04: tiers, highest authority first. Absent on documents from before RT-04: read as the default.
  sourcePriority?: TierId[]
  // PV-09: set once Never masked was seeded from privacy-service's allow-list file, so a default
  // the admin removed is never seeded again.
  privacyWordsSeeded?: boolean
  metadata: SettingsMetadata
}

export interface SettingsMetadata {
  source_type: 'settings' | 'settings_change'
  jurisdiction: null
  facility_type: null
  COPE_dimension: null
  effective_date: Date
}

// The same null-filled metadata block on every settings document (CLAUDE.md hard rule).
export const metadataSchema = {
  source_type: { type: String, enum: ['settings', 'settings_change'], required: true },
  jurisdiction: { type: String, default: null },
  facility_type: { type: String, default: null },
  COPE_dimension: { type: String, default: null },
  effective_date: { type: Date, required: true },
}

const appSettingsSchema = new Schema<IAppSettings>(
  {
    key: { type: String, enum: ['global'], default: 'global', unique: true },
    models: { type: Schema.Types.Mixed, default: {} },
    qaStrictness: { type: String, enum: QA_STRICTNESS, default: 'standard' },
    sourcePriority: { type: [String], enum: TIER_IDS, default: () => [...DEFAULT_TIER_ORDER] },
    privacyWordsSeeded: { type: Boolean, default: false },
    metadata: metadataSchema,
  },
  { collection: 'app_settings', minimize: false },
)

export const AppSettingsModel = model<IAppSettings>('AppSettings', appSettingsSchema)
