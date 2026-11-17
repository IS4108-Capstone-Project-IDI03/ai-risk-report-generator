// S-01 AC15: who changed a default or a global setting, when, and the value before and after.
// Append-only like review_audit_log: the model refuses every update and delete.
// Written by settings.service.ts.
import { Schema, model } from 'mongoose'
import { metadataSchema, type SettingsMetadata } from './app-settings.model'

export interface ISettingsLogEntry {
  by: { id: string; name: string }
  at: Date
  // What changed, e.g. "models.drafting", "qaStrictness", "defaults.standardsTargetPct".
  setting: string
  before: unknown
  after: unknown
  metadata: SettingsMetadata
}

export class SettingsLogAppendOnlyError extends Error {
  constructor() {
    super('The settings log is append-only: its entries cannot be changed or deleted.')
    this.name = 'SettingsLogAppendOnlyError'
  }
}

const settingsLogSchema = new Schema<ISettingsLogEntry>(
  {
    by: { id: { type: String, required: true }, name: { type: String, required: true } },
    at: { type: Date, required: true },
    setting: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    metadata: metadataSchema,
  },
  { collection: 'settings_log', minimize: false },
)
settingsLogSchema.index({ at: -1 })

function refuse(): never {
  throw new SettingsLogAppendOnlyError()
}
settingsLogSchema.pre('save', function () {
  if (!this.isNew) refuse()
})
for (const method of ['updateOne', 'deleteOne'] as const) {
  settingsLogSchema.pre(method, { document: true, query: true }, refuse)
}
for (const method of [
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  settingsLogSchema.pre(method, refuse)
}

export const SettingsLogModel = model<ISettingsLogEntry>('SettingsLog', settingsLogSchema)
