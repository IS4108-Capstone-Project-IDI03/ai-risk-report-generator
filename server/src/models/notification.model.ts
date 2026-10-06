import { Schema, Types, model } from 'mongoose'
import { USER_ROLES, type UserRole } from './user.model'

// What a notification is about. A closed set, so a purpose always has a known
// audience and a known screen to open. Only `ingestion_status` has a producer
// today; the rest are the agreed next purposes, each grounded in an event the
// code already records:
//   transcription_status        runTranscription / failInterruptedTranscriptions
//   drafting_status             draftSection's guardrail and open questions
//   knowledge_document_status   correct / withdraw / reinstate (KB-01)
//   account_status              createUser, and updateUser changing role or active
//   assessment_status           createAssessment, archive, restore
// Deadline and reminder purposes are deliberately absent: nothing schedules
// work in this repo, so nothing could fire them.
export const NOTIFICATION_PURPOSES = [
  'ingestion_status',
  'transcription_status',
  'drafting_status',
  'knowledge_document_status',
  'account_status',
  'assessment_status',
] as const
export type NotificationPurpose = (typeof NOTIFICATION_PURPOSES)[number]

// Every user of the target role sees the notification. Stored as the first
// element of targetUserIds.
export const AUDIENCE_ALL = 'all'

// Notifications are kept for 90 days, then dropped by the TTL index below.
// Nothing deletes them otherwise — "dismiss all" is per user (see dismissedBy),
// so without an expiry the collection would only ever grow.
export const NOTIFICATION_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * One event a user is told about. A notification is shared by the users it
 * targets rather than copied per user, so who has read or dismissed it is held
 * as a list of user ids on the one document.
 */
export interface INotification {
  purpose: NotificationPurpose
  // The line shown in the dropdown. Sentence case, no emoji (docs/areas/ui.md).
  message: string
  // Longer text behind the row's expand control, e.g. the failure reason.
  details?: string
  // The role this notification is for. Read paths match it against the
  // session's current role, never a copy stored per recipient, so moving a user
  // between roles changes what they see at once.
  targetRole: UserRole
  // Who, within that role, sees it: user ids, or [AUDIENCE_ALL] for everyone
  // holding the role. Required and non-empty — an empty audience would be a
  // notification nobody could ever see.
  targetUserIds: string[]
  // Per-user state, because the document is shared. Dismissing adds the user
  // here rather than deleting, which would clear it for everyone else too.
  readBy: string[]
  dismissedBy: string[]
  // Who or what created it. A notification from a microservice has no user, so
  // both are nullable and exactly one is normally set.
  createdBy: Types.ObjectId | null
  createdByService: string | null
  // Purpose-specific payload, e.g. { documentId, stage } for ingestion_status.
  // Not named `metadata`: in this codebase that means the five mandatory label
  // fields (see CLAUDE.md), and notifications carry none of them — they are not
  // retrieval evidence.
  context?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

const notificationSchema = new Schema<INotification>(
  {
    purpose: { type: String, enum: NOTIFICATION_PURPOSES, required: true },
    message: { type: String, required: true, trim: true },
    details: { type: String, trim: true },
    targetRole: { type: String, enum: USER_ROLES, required: true },
    // `required` alone is not enough: Mongoose treats [] as present, so a
    // notification with no audience would save and then be shown to nobody.
    targetUserIds: {
      type: [String],
      required: true,
      validate: {
        validator: (ids: string[]) => ids.length > 0,
        message: 'A notification needs at least one target user id, or ["all"].',
      },
    },
    readBy: { type: [String], default: [] },
    dismissedBy: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    createdByService: { type: String, default: null, trim: true },
    context: { type: Map, of: String, default: undefined },
  },
  { timestamps: true, collection: 'notifications' },
)

// The dropdown's query: the caller's role, newest first.
notificationSchema.index({ targetRole: 1, createdAt: -1 })
// Expiry (see NOTIFICATION_TTL_SECONDS).
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS })

export const NotificationModel = model<INotification>('Notification', notificationSchema)
