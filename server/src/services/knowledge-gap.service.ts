// Knowledge gap requests (CB-07): an engineer asks an admin to add a document,
// the admin fills or dismisses it, and the right person is notified each time.
// Called by routes/knowledge-gap.routes.ts. Calls notification.service.ts.
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import {
  KnowledgeGapRequestModel,
  type GapRequestStatus,
  type IKnowledgeGapRequest,
} from '../models/knowledge-gap-request.model'
import { UserModel } from '../models/user.model'
import type { SessionUser } from './auth.service'
import { createNotification, type NewNotification } from './notification.service'

export const createRequestSchema = z.object({
  question: z.string('A question is required.').trim().min(1, 'A question is required.').max(4000),
  // Blank becomes absent, so an empty box saves no message.
  message: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((m) => m || undefined),
})
export const fillRequestSchema = z.object({
  documentIds: z.array(z.string()).min(1, 'Pick at least one document.'),
})
export const dismissRequestSchema = z.object({
  reason: z.string('A reason is required.').trim().min(1, 'A reason is required.').max(500),
})

export class GapRequestNotFoundError extends Error {
  constructor() {
    super('That request no longer exists.')
  }
}
export class GapRequestClosedError extends Error {
  constructor() {
    super('This request was already closed.')
  }
}
// A body that parses but names things that do not exist; routes answer 400.
export class GapRequestInvalidError extends Error {
  constructor(public fields: Record<string, string>) {
    super('The request is invalid.')
  }
}

/** A request as the client reads it. */
export type GapRequestDto = {
  id: string
  question: string
  message?: string
  askedBy: { id: string; name: string }
  createdAt: string
  status: GapRequestStatus
}

type Stored = IKnowledgeGapRequest & { _id: Types.ObjectId }

const toDto = (r: Stored, name: string): GapRequestDto => ({
  id: String(r._id),
  question: r.question,
  ...(r.message ? { message: r.message } : {}),
  askedBy: { id: String(r.askedBy), name },
  createdAt: r.createdAt.toISOString(),
  status: r.status,
})

// Asker names by id; a deleted account shows as "Unknown user".
async function namesFor(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await UserModel.find({ _id: { $in: ids } }, 'name').lean()
  return new Map(users.map((u) => [String(u._id), u.name]))
}

// Without the catch, a notification error would fail an action that already
// saved: the request is the record, the notification only a nudge.
async function notifyQuietly(input: NewNotification) {
  try {
    await createNotification(input)
  } catch (error) {
    console.error('Could not create the knowledge request notification:', error)
  }
}

/** Saves a new open request from an engineer and tells every knowledge admin. Returns it. */
export async function createRequest(
  input: z.infer<typeof createRequestSchema>,
  user: SessionUser,
): Promise<GapRequestDto> {
  const saved = (
    await KnowledgeGapRequestModel.create({ ...input, askedBy: user.id })
  ).toObject() as Stored
  await notifyQuietly({
    purpose: 'knowledge_gap_request',
    message: 'New knowledge request',
    details: [saved.question, saved.message].filter(Boolean).join('\n'),
    targetRole: 'knowledge_admin',
    targetUserIds: ['all'],
    // The client lays these parts out (NotificationRow.tsx), so every value stays a string.
    context: {
      requestId: String(saved._id),
      question: saved.question,
      askedBy: user.name,
      ...(saved.message ? { message: saved.message } : {}),
    },
    createdBy: user.id,
  })
  return toDto(saved, user.name)
}

/** Returns the open requests, newest first, each with the asker's name. */
export async function listOpenRequests(): Promise<GapRequestDto[]> {
  const open = await KnowledgeGapRequestModel.find({ status: 'open' })
    .sort({ createdAt: -1, _id: -1 })
    .lean<Stored[]>()
  const names = await namesFor(open.map((r) => r.askedBy))
  return open.map((r) => toDto(r, names.get(String(r.askedBy)) ?? 'Unknown user'))
}

// Closes a request only while it is still open, so two admins acting at once
// cannot both win. Throws not-found (no such id) or closed (someone got there first).
async function closeRequest(
  id: string,
  closer: SessionUser,
  changes: Partial<IKnowledgeGapRequest>,
): Promise<Stored> {
  if (!isValidObjectId(id)) throw new GapRequestNotFoundError()
  const closed = await KnowledgeGapRequestModel.findOneAndUpdate(
    { _id: id, status: 'open' },
    { ...changes, closedBy: closer.id, closedAt: new Date() },
    { returnDocument: 'after' },
  ).lean<Stored>()
  if (closed) return closed
  throw (await KnowledgeGapRequestModel.exists({ _id: id }))
    ? new GapRequestClosedError()
    : new GapRequestNotFoundError()
}

const outcomeNotification = (
  r: Stored,
  status: 'filled' | 'dismissed',
  lines: string[],
  parts: Record<string, string>,
  closer: SessionUser,
): NewNotification => ({
  purpose: 'knowledge_gap_request',
  message: `Your knowledge request was ${status}`,
  details: [r.question, ...lines].join('\n'),
  targetRole: 'risk_engineer',
  targetUserIds: [String(r.askedBy)],
  context: { requestId: String(r._id), status, question: r.question, ...parts },
  createdBy: closer.id,
})

const askerName = async (r: Stored) =>
  (await namesFor([r.askedBy])).get(String(r.askedBy)) ?? 'Unknown user'

/** Marks a request filled with existing knowledge documents and tells the asker. Returns it. */
export async function fillRequest(
  id: string,
  documentIds: string[],
  admin: SessionUser,
): Promise<GapRequestDto> {
  const unique = [...new Set(documentIds)]
  const docs = unique.every(isValidObjectId)
    ? await KnowledgeDocumentModel.find({ _id: { $in: unique } }, 'title edition createdAt').lean()
    : []
  if (docs.length !== unique.length) {
    throw new GapRequestInvalidError({ documentIds: 'Pick documents that exist.' })
  }
  const closed = await closeRequest(id, admin, {
    status: 'filled',
    documentIds: docs.map((d) => d._id),
  })
  // Listed in the order the admin picked them.
  const byId = new Map(docs.map((d) => [String(d._id), d]))
  const lines = unique.map((docId) => {
    const d = byId.get(docId)!
    const uploaded = d.createdAt.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return [d.title, d.edition && `Edition ${d.edition}`, `uploaded ${uploaded}`]
      .filter(Boolean)
      .join(' · ')
  })
  const documents = JSON.stringify(
    unique.map((docId) => {
      const d = byId.get(docId)!
      return { title: d.title, uploadedAt: d.createdAt.toISOString() }
    }),
  )
  await notifyQuietly(outcomeNotification(closed, 'filled', lines, { documents }, admin))
  return toDto(closed, await askerName(closed))
}

/** Marks a request dismissed with a reason and tells the asker. Returns it. */
export async function dismissRequest(
  id: string,
  reason: string,
  admin: SessionUser,
): Promise<GapRequestDto> {
  const closed = await closeRequest(id, admin, { status: 'dismissed', reason })
  await notifyQuietly(
    outcomeNotification(closed, 'dismissed', [`Reason: ${reason}`], { reason }, admin),
  )
  return toDto(closed, await askerName(closed))
}
