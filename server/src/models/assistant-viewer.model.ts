// One person's view of one assessment's MarshBot (AS-06): when they last opened
// its Overview, what they dismissed, and when they last opened Review.
// Written by services/assistant/brief.service.ts and replies.service.ts; read by
// context.ts, coverage.service.ts and thread.service.ts.
// Not a knowledge or observation document, so the metadata-fields rule doesn't apply.
import { Schema, Types, model } from 'mongoose'

export interface IAssistantViewer {
  assessment: Types.ObjectId
  user: Types.ObjectId
  // When they last opened the Overview: a re-check moves an open conversation on.
  openedAt: Date | null
  // Each dismissed item holds while its fingerprint is unchanged (AC 6).
  dismissed: { itemId: string; fingerprint: string }[]
  reviewOpenedAt: Date | null
  // The stale-export fingerprint "Export again" was pressed for: MarshBot then
  // points at the Export tab instead of asking again.
  exportAgain: string | null
  // When they said "I've read the checklist": counts as read until the checklist is made again.
  checklistReadAt: Date | null
}

const viewerSchema = new Schema<IAssistantViewer>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    openedAt: { type: Date, default: null },
    dismissed: {
      type: [{ _id: false, itemId: String, fingerprint: String }],
      default: [],
    },
    reviewOpenedAt: { type: Date, default: null },
    exportAgain: { type: String, default: null },
    checklistReadAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'assistant_viewers' },
)
viewerSchema.index({ assessment: 1, user: 1 }, { unique: true })

export const AssistantViewerModel = model<IAssistantViewer>('AssistantViewer', viewerSchema)
