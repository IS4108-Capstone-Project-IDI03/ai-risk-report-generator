// The engineer's running activity totals in one place of one assessment
// (AS-06 Architecture 5): engaged time, and how long each thing was on screen.
// Places: `tab:<tab>`, `checklist`, `section:<id>`, `review`. Written by
// services/assistant/brief.service.ts (POST activity); read by the reminder checks.
// Not a knowledge or observation document, so the metadata-fields rule doesn't apply.
import { Schema, Types, model } from 'mongoose'

export interface IAssistantActivity {
  assessment: Types.ObjectId
  user: Types.ObjectId
  place: string
  engagedMs: number
  // Milliseconds on screen by key (checklist item id, finding key `0.2`,
  // `question:<n>`). Keys are stored encoded (see activityKey), as MongoDB
  // can't $inc a field whose name holds a dot.
  seen: Record<string, number>
  // Set by Mongoose timestamps; the first one is when tracking began (quick-decision).
  createdAt: Date
}

const activitySchema = new Schema<IAssistantActivity>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    place: { type: String, required: true },
    engagedMs: { type: Number, default: 0 },
    seen: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'assistant_activity', minimize: false },
)
activitySchema.index({ assessment: 1, user: 1, place: 1 }, { unique: true })

export const AssistantActivityModel = model<IAssistantActivity>('AssistantActivity', activitySchema)
