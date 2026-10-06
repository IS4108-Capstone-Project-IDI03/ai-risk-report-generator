// Notifications for the header dropdown: create one, list a user's, mark one
// read, dismiss them all. Called by routes/notification.routes.ts and
// routes/internal-notification.routes.ts.
//
// A notification is shared by the users it targets rather than copied per
// user, so everything here is written around two consequences: who has read or
// dismissed it lives on the one document as lists of user ids, and nothing is
// ever deleted on a user's behalf.
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import {
  AUDIENCE_ALL,
  NOTIFICATION_PURPOSES,
  NotificationModel,
  type INotification,
  type NotificationPurpose,
} from '../models/notification.model'
import { USER_ROLES, type UserRole } from '../models/user.model'
import type { SessionUser } from './auth.service'

export class NotificationNotFoundError extends Error {
  constructor() {
    super('That notification no longer exists.')
    this.name = 'NotificationNotFoundError'
  }
}

export type NewNotification = {
  purpose: NotificationPurpose
  message: string
  details?: string
  targetRole: UserRole
  targetUserIds: string[]
  context?: Record<string, string>
  createdBy?: Types.ObjectId | string | null
  createdByService?: string | null
}

// The body another service may post to create a notification (Task 4). An
// unknown purpose or role is a 400 naming the field, so a typo in a calling
// service fails loudly rather than creating a notification nobody can see.
// `createdByService` is required here — a service-made notification should say
// which service made it; `createdBy` (a user) is never accepted over this path.
export const externalNotificationSchema = z.object({
  purpose: z.enum(NOTIFICATION_PURPOSES, 'Choose a known notification purpose.'),
  message: z.string('A message is required.').trim().min(1, 'A message is required.').max(500),
  details: z.string().trim().max(2000).optional(),
  targetRole: z.enum(USER_ROLES, 'Choose a known role.'),
  targetUserIds: z.array(z.string().min(1)).min(1, 'Name at least one target user id, or ["all"].'),
  context: z.record(z.string(), z.string()).optional(),
  createdByService: z
    .string('A creating service is required.')
    .trim()
    .min(1, 'A creating service is required.'),
})

export type ExternalNotification = z.infer<typeof externalNotificationSchema>

/**
 * One notification as the dropdown reads it. `read` is this caller's state,
 * not the document's: `readBy` and `dismissedBy` hold other users' ids, and
 * `targetUserIds` names the audience, so none of them leave the server.
 */
export type NotificationDto = {
  id: string
  purpose: NotificationPurpose
  message: string
  details: string | null
  context: Record<string, string> | null
  read: boolean
  createdAt: Date
}

export type NotificationPage = {
  items: NotificationDto[]
  total: number
  unread: number
}

type StoredNotification = INotification & { _id: unknown }

// `readerId` is whose `read` state the DTO reports. '' is nobody, for a
// notification just created that no one has read yet.
function toDto(notification: StoredNotification, readerId: string): NotificationDto {
  return {
    id: String(notification._id),
    purpose: notification.purpose,
    message: notification.message,
    details: notification.details ?? null,
    // A plain object from both read paths: lean() gives one already, and
    // toObject({ flattenMaps: true }) below turns the stored Map into one.
    context: notification.context ? { ...notification.context } : null,
    read: notification.readBy.includes(readerId),
    createdAt: notification.createdAt,
  }
}

/**
 * What this user may see: their role's notifications, addressed either to the
 * whole role or to them by id, less the ones they have dismissed.
 *
 * The role comes from the session on every request and is never copied onto
 * the notification, so a user moved between roles sees the new role's
 * notifications immediately and the old role's not at all — no existing
 * document has to be rewritten.
 *
 * `targetUserIds.0` is matched rather than the whole array because the
 * sentinel is positional: ['all'] leads the audience when it means everyone
 * holding the role.
 */
function visibleTo(user: SessionUser) {
  return {
    targetRole: user.role,
    $or: [{ [`targetUserIds.0`]: AUDIENCE_ALL }, { targetUserIds: user.id }],
    dismissedBy: { $ne: user.id },
  }
}

/** Returns the notification just created, which nobody has read yet. */
export async function createNotification(input: NewNotification): Promise<NotificationDto> {
  const created = await NotificationModel.create({
    purpose: input.purpose,
    message: input.message,
    details: input.details,
    targetRole: input.targetRole,
    targetUserIds: input.targetUserIds,
    context: input.context,
    createdBy: input.createdBy ?? null,
    createdByService: input.createdByService ?? null,
  })
  // flattenMaps so `context` is a plain object here as it is from a lean read;
  // without it a hydrated document hands back a Map and the two paths disagree.
  // Nobody has read it yet, hence no reader.
  return toDto(created.toObject({ flattenMaps: true }) as StoredNotification, '')
}

/**
 * Returns one page of the user's notifications, newest first, with the totals
 * the dropdown needs: `total` to decide whether to offer Load more, `unread`
 * for the count on the bell. Both cover every page, not just this one, and
 * `total` is returned on every page so a figure taken at sign-in corrects
 * itself as soon as the list is opened.
 *
 * Ties on createdAt break by _id, which is monotonic, so paging cannot show
 * the same notification twice or skip one when several share a timestamp.
 */
export async function listForUser(
  user: SessionUser,
  limit: number,
  offset: number,
): Promise<NotificationPage> {
  const filter = visibleTo(user)
  const [notifications, counts] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean<StoredNotification[]>(),
    countsForUser(user),
  ])
  return { items: notifications.map((n) => toDto(n, user.id)), ...counts }
}

/** How many the user can see, and how many of those they have not read. */
export async function countsForUser(user: SessionUser): Promise<{
  total: number
  unread: number
}> {
  const filter = visibleTo(user)
  const [total, unread] = await Promise.all([
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ ...filter, readBy: { $ne: user.id } }),
  ])
  return { total, unread }
}

/**
 * Marks one notification read for this user. Throws NotificationNotFoundError
 * for an id that is malformed, unknown, or outside what the caller may see —
 * one answer for all three, so the call cannot be used to find out whether a
 * notification exists for someone else.
 */
export async function markAsRead(id: string, user: SessionUser): Promise<void> {
  if (!isValidObjectId(id)) throw new NotificationNotFoundError()
  const { matchedCount } = await NotificationModel.updateOne(
    { _id: id, ...visibleTo(user) },
    { $addToSet: { readBy: user.id } },
  )
  if (!matchedCount) throw new NotificationNotFoundError()
}

/**
 * Marks every notification the user can see as read, for this user only.
 * Like markAsRead but across the whole visible set, so one admin clearing
 * their badge leaves every other admin's unchanged. Reading is not
 * dismissing: the notifications stay in the list and later ones arrive unread.
 */
export async function markAllReadForUser(user: SessionUser): Promise<void> {
  await NotificationModel.updateMany(visibleTo(user), { $addToSet: { readBy: user.id } })
}

/**
 * Clears the user's list. Adds them to `dismissedBy` rather than deleting:
 * the document is shared, so deleting would clear it for everyone else in the
 * role too. Notifications created afterwards are unaffected.
 */
export async function dismissAllForUser(user: SessionUser): Promise<void> {
  await NotificationModel.updateMany(visibleTo(user), { $addToSet: { dismissedBy: user.id } })
}
