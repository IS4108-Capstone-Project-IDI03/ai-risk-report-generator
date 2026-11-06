// Notifications for the header bell and the Inbox (F-10): create one, list a
// user's, open, tick, bin and restore one. Called by routes/notification.routes.ts,
// routes/internal-notification.routes.ts and the services that notify (assessment
// assignment, site walks, knowledge requests).
//
// A notification is shared by the users it targets rather than copied per
// user, so everything here is written around two consequences: who has read or
// dismissed it lives on the one document as lists of user ids, and nothing is
// ever deleted on a user's behalf. The Inbox and the bell are two views of the
// same collection, told apart by `kind`.
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import {
  AUDIENCE_ALL,
  NOTIFICATION_KINDS,
  NOTIFICATION_PURPOSES,
  NotificationModel,
  type INotification,
  type NotificationKind,
  type NotificationPurpose,
} from '../models/notification.model'
import { USER_ROLES, UserModel, type UserRole } from '../models/user.model'
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

// The list's query string: which view (the bell by default, or the Inbox) and,
// for the Inbox, which tab. A value outside the set is a 400 naming the field.
export const listQuerySchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS, 'kind must be bell or inbox.').default('bell'),
  tab: z.enum(['todo', 'done'], 'tab must be todo or done.').default('todo'),
})

/**
 * One notification as the bell and the Inbox read it. `read` and `done` are this
 * caller's state, not the document's: `readBy` and `dismissedBy` hold other
 * users' ids and `targetUserIds` names the audience, so none of them leave the server.
 */
export type NotificationDto = {
  id: string
  purpose: NotificationPurpose
  kind: NotificationKind
  message: string
  details: string | null
  context: Record<string, string> | null
  read: boolean
  // Inbox only: Done for this caller, because they opened or ticked it.
  done: boolean
  createdAt: Date
}

export type NotificationPage = {
  items: NotificationDto[]
  // The rows matching this kind and tab across all pages.
  total: number
  // The bell's unread count, whatever kind was listed.
  unread: number
  // The caller's Inbox To do count.
  inboxTodo: number
}

type Figures = Pick<NotificationPage, 'total' | 'unread' | 'inboxTodo'>

export type NotificationCounts = Figures & {
  // When the newest Inbox item and the newest bell item addressed to this person arrived, in any
  // state (Done, read and binned too), or null. The client compares these, not the counts, to tell
  // a new item from one coming back by an untick. Only the newest To do would not do: a person
  // whose newest item sat in Done would hear it as new when an untick brought it back.
  newestInbox: string | null
  newestBell: string | null
}

type StoredNotification = INotification & { _id: unknown }

// `readerId` is whose `read` state the DTO reports. '' is nobody, for a
// notification just created that no one has read yet.
function toDto(notification: StoredNotification, readerId: string): NotificationDto {
  return {
    id: String(notification._id),
    purpose: notification.purpose,
    kind: notification.kind ?? 'bell',
    message: notification.message,
    details: notification.details ?? null,
    // A plain object from both read paths: lean() gives one already, and
    // toObject({ flattenMaps: true }) below turns the stored Map into one.
    context: notification.context ? { ...notification.context } : null,
    read: notification.readBy.includes(readerId),
    done: notification.kind === 'inbox' && notification.readBy.includes(readerId),
    createdAt: notification.createdAt,
  }
}

/**
 * The notifications addressed to this user: their role's, addressed either to
 * the whole role or to them by id.
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
function addressedTo(user: SessionUser) {
  return {
    targetRole: user.role,
    $or: [{ [`targetUserIds.0`]: AUDIENCE_ALL }, { targetUserIds: user.id }],
  }
}

// What this user may see: addressed to them, less the ones they have binned.
function visibleTo(user: SessionUser) {
  return { ...addressedTo(user), dismissedBy: { $ne: user.id } }
}

// The bell is everything that is not an Inbox item. Matched as "not inbox"
// rather than "is bell" so a document saved before F-10, with no kind, stays
// in the bell.
const BELL = { kind: { $ne: 'inbox' as const } }

// To do and Done for one user are worked out, never stored (F-10): To do is
// not in their `readBy`, Done is in it. Opening and ticking both add them, so
// what one admin does never moves the item for another.
// Joined with $and because visibleTo already uses a top-level $or.
function inboxFor(user: SessionUser, tab: InboxTab) {
  const state = tab === 'todo' ? { readBy: { $ne: user.id } } : { readBy: user.id }
  return { $and: [visibleTo(user), { kind: 'inbox' as const }, state] }
}

export type InboxTab = 'todo' | 'done'

// Where each purpose goes (F-10), the only place that decides it. The Inbox
// holds what stalls work if the person ignores it; the worker's own status is
// read from the context so the ingestion worker needs no change. A purpose not
// listed is a bell one.
const GOES_TO_INBOX: Partial<Record<NotificationPurpose, (status?: string) => boolean>> = {
  // A document that failed or needs review; a finished one is an update.
  ingestion_status: (status) => status === 'failed' || status === 'needs_review',
  // A new request has no status; its outcome (filled, dismissed) is for the asker's bell.
  knowledge_gap_request: (status) => !status,
  site_walk_ready: () => true,
  site_walk_failed: () => true,
  assessment_assigned: () => true,
}

function kindFor(purpose: NotificationPurpose, context?: Record<string, string>): NotificationKind {
  return GOES_TO_INBOX[purpose]?.(context?.status) ? 'inbox' : 'bell'
}

/**
 * Returns the notification just created, which nobody has read yet.
 *
 * When the context identifies a terminal event — both a `documentId` and a
 * `status` — creation is idempotent on `purpose + documentId + status +
 * attempt`: posting the same event again returns the existing notification
 * rather than a second row. This matters because a stalled BullMQ job can
 * re-run a document and reach a terminal state twice (see worker.py), which
 * would otherwise show the admin the same failure twice. The `attempt` (the
 * retry number) keeps a genuine retry distinct: a document that fails, is
 * retried, and fails again notifies afresh rather than deduping into silence.
 */
export async function createNotification(input: NewNotification): Promise<NotificationDto> {
  const doc = {
    purpose: input.purpose,
    kind: kindFor(input.purpose, input.context),
    message: input.message,
    details: input.details,
    targetRole: input.targetRole,
    targetUserIds: input.targetUserIds,
    context: input.context,
    createdBy: input.createdBy ?? null,
    createdByService: input.createdByService ?? null,
  }

  const key = dedupeKey(input)
  if (key) {
    // Upsert on the natural key: insert on first sight, no-op on a repeat. The
    // $setOnInsert keeps the first notification's content (and its readBy /
    // dismissedBy) untouched when the event is re-posted.
    const existing = await NotificationModel.findOneAndUpdate(
      key,
      { $setOnInsert: doc },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean<StoredNotification>()
    return toDto(existing, '')
  }

  const created = await NotificationModel.create(doc)
  // flattenMaps so `context` is a plain object here as it is from a lean read;
  // without it a hydrated document hands back a Map and the two paths disagree.
  // Nobody has read it yet, hence no reader.
  return toDto(created.toObject({ flattenMaps: true }) as StoredNotification, '')
}

// The natural key for a terminal event, or null when the context does not name
// one (so those notifications are never deduped). Matched on the stored Map
// fields with dotted paths.
function dedupeKey(input: NewNotification): Record<string, unknown> | null {
  // A site walk becomes ready once (CP-22), so its walk alone is the key.
  if (input.purpose === 'site_walk_ready' && input.context?.walkId)
    return { purpose: input.purpose, 'context.walkId': input.context.walkId }
  // A walk can fail, be retried and fail again, and each failure tells the
  // engineer. `attempt` is the walk's retry count, absent for the first try,
  // as for a document below.
  if (input.purpose === 'site_walk_failed' && input.context?.walkId)
    return {
      purpose: input.purpose,
      'context.walkId': input.context.walkId,
      'context.attempt': input.context.attempt ?? { $exists: false },
    }
  const documentId = input.context?.documentId
  const status = input.context?.status
  if (!documentId || !status) return null
  return {
    purpose: input.purpose,
    'context.documentId': documentId,
    'context.status': status,
    // The retry number, or absent for the first attempt. A missing field and
    // "1" are different keys, so the original failure and retry #1 are distinct
    // notifications, while a re-delivery of the same attempt still dedupes.
    'context.attempt': input.context?.attempt ?? { $exists: false },
  }
}

/**
 * Returns one page of the user's bell or Inbox notifications, newest first,
 * with the totals the screens need: `total` to decide whether to offer Load
 * more, `unread` for the count on the bell and `inboxTodo` for the sidebar. All
 * cover every page, not just this one, and are returned on every page so a
 * figure taken at sign-in corrects itself as soon as a list is opened.
 *
 * Ties on createdAt break by _id, which is monotonic, so paging cannot show
 * the same notification twice or skip one when several share a timestamp.
 */
export async function listForUser(
  user: SessionUser,
  limit: number,
  offset: number,
  view: { kind: NotificationKind; tab: InboxTab } = { kind: 'bell', tab: 'todo' },
): Promise<NotificationPage> {
  const filter = view.kind === 'inbox' ? inboxFor(user, view.tab) : { ...visibleTo(user), ...BELL }
  const [notifications, total, figures] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean<StoredNotification[]>(),
    NotificationModel.countDocuments(filter),
    figuresFor(user),
  ])
  return {
    items: notifications.map((n) => toDto(n, user.id)),
    total,
    unread: figures.unread,
    inboxTodo: figures.inboxTodo,
  }
}

// The three counts, kept apart from the newest times so a list page doesn't pay for those too.
async function figuresFor(user: SessionUser): Promise<Figures> {
  const bell = { ...visibleTo(user), ...BELL }
  const [total, unread, inboxTodo] = await Promise.all([
    NotificationModel.countDocuments(bell),
    NotificationModel.countDocuments({ ...bell, readBy: { $ne: user.id } }),
    NotificationModel.countDocuments(inboxFor(user, 'todo')),
  ])
  return { total, unread, inboxTodo }
}

// When the newest match arrived. Walks the role's createdAt index from the newest down and
// stops at the first match, so it costs less than a count.
async function newestOf(filter: Record<string, unknown>): Promise<string | null> {
  const newest = await NotificationModel.findOne(filter, 'createdAt')
    .sort({ createdAt: -1 })
    .lean<Pick<INotification, 'createdAt'>>()
  return newest?.createdAt.toISOString() ?? null
}

/**
 * Returns how many bell notifications the user can see and has not read, their Inbox To do
 * count, and when the newest Inbox and bell items addressed to them arrived, in any state.
 */
export async function countsForUser(user: SessionUser): Promise<NotificationCounts> {
  const [figures, newestInbox, newestBell] = await Promise.all([
    figuresFor(user),
    newestOf({ ...addressedTo(user), kind: 'inbox' }),
    newestOf({ ...addressedTo(user), ...BELL }),
  ])
  return { ...figures, newestInbox, newestBell }
}

// Applies one change to one notification the user may see, or throws
// NotificationNotFoundError: the id is malformed, unknown or outside what the
// caller may see, one answer for all three so the call cannot be used to find
// out whether a notification exists for someone else.
async function changeOne(
  id: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  if (!isValidObjectId(id)) throw new NotificationNotFoundError()
  const { matchedCount } = await NotificationModel.updateOne({ _id: id, ...filter }, update)
  if (!matchedCount) throw new NotificationNotFoundError()
}

/**
 * Opens one notification for this user (adds them to `readBy`); on an Inbox
 * item that moves it to Done for them alone. Throws NotificationNotFoundError,
 * as for every change below.
 */
export async function markAsRead(id: string, user: SessionUser): Promise<void> {
  await changeOne(id, visibleTo(user), { $addToSet: { readBy: user.id } })
}

/** Ticks an Inbox item: Done for this user only. A bell item is not found. */
export async function markDone(id: string, user: SessionUser): Promise<void> {
  await changeOne(id, { ...visibleTo(user), kind: 'inbox' }, { $addToSet: { readBy: user.id } })
}

/**
 * Unticks an Inbox item: it returns to To do for this user only, whether they
 * ticked or opened it. A bell item is not found.
 */
export async function unmarkDone(id: string, user: SessionUser): Promise<void> {
  await changeOne(id, { ...visibleTo(user), kind: 'inbox' }, { $pull: { readBy: user.id } })
}

/**
 * Marks every bell notification the user can see as read, for this user only.
 * Like markAsRead but across the whole visible bell, so one admin clearing
 * their badge leaves every other admin's unchanged. Reading is not
 * dismissing: the notifications stay in the list and later ones arrive unread.
 * Inbox items are left alone: opening one is how it moves to Done.
 */
export async function markAllReadForUser(user: SessionUser): Promise<void> {
  await NotificationModel.updateMany(
    { ...visibleTo(user), ...BELL },
    { $addToSet: { readBy: user.id } },
  )
}

/**
 * Clears the user's bell. Adds them to `dismissedBy` rather than deleting:
 * the document is shared, so deleting would clear it for everyone else in the
 * role too. Notifications created afterwards are unaffected. Bell only: without
 * that filter, "Dismiss all" in the bell would silently wipe the Inbox.
 */
export async function dismissAllForUser(user: SessionUser): Promise<void> {
  await NotificationModel.updateMany(
    { ...visibleTo(user), ...BELL },
    { $addToSet: { dismissedBy: user.id } },
  )
}

/**
 * Dismisses (bins) one notification for this user only (adds them to
 * `dismissedBy`). Same visibility rule and not-found answer as markAsRead.
 */
export async function dismissForUser(id: string, user: SessionUser): Promise<void> {
  await changeOne(id, visibleTo(user), { $addToSet: { dismissedBy: user.id } })
}

/**
 * Undoes a bin: takes this user out of `dismissedBy`. Matches on who it is
 * addressed to, not on visibleTo, which would hide exactly the item to restore.
 */
export async function restoreForUser(id: string, user: SessionUser): Promise<void> {
  await changeOne(id, addressedTo(user), { $pull: { dismissedBy: user.id } })
}

/**
 * Returns who to address a notification to so the person sees it: their
 * CURRENT role, looked up, plus their id; null for an account that no longer
 * exists. Read paths match `targetRole` against the role in the session, so a
 * role hardcoded by the producer would hide the item from, say, an admin who
 * holds the assessment.
 */
export async function audienceOf(
  userId: string,
): Promise<{ targetRole: UserRole; targetUserIds: string[] } | null> {
  const user = isValidObjectId(userId) ? await UserModel.findById(userId, 'role').lean() : null
  return user ? { targetRole: user.role, targetUserIds: [String(user._id)] } : null
}

/**
 * Takes this person's Inbox items for one assessment out of their Inbox, when
 * the assessment moves away from them. Items are found by `context.reference`
 * and by naming them in `targetUserIds`, and the person is pulled from that
 * list, so they cannot bring one back with restore (which matches on it). If
 * they were the only target the list is left empty: nobody sees the item, and
 * the 90-day expiry drops it. Nobody else's Inbox changes. An item for the whole
 * role is never matched, since it names no user.
 */
export async function removeAssessmentItems(reference: string, userId: string): Promise<void> {
  // Safe despite the model's "at least one target" check: updateMany skips
  // schema validators (runValidators is off), so an empty list can be saved here.
  await NotificationModel.updateMany(
    { kind: 'inbox', 'context.reference': reference, targetUserIds: userId },
    { $pull: { targetUserIds: userId } },
  )
}
