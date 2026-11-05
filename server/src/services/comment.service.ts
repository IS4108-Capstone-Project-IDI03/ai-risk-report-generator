// Comment threads on the report (RV-03): starting a thread on a passage,
// replying, editing and deleting one's own comments, resolving and reopening,
// and moving each thread's anchor as the document editor saves the text under
// it. Called by routes/comment.routes.ts; the export's open-thread reminder
// (EX-01) is counted here too.
//
// Anyone who can open the assessment (opensAssessment: its assigned engineer
// or a knowledge admin) reads and writes threads, with `reports:comment` in
// F-05's matrix; an archived assessment's threads are only read. A comment is
// changed or deleted only by its author (AC3).
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import type { CopeDimension } from '../models/observation.model'
import {
  ReportCommentThreadModel,
  SECTION_ID,
  type ICommentAnchor,
  type IReportComment,
  type IReportCommentThread,
  type Stamp,
  type ThreadStatus,
} from '../models/report-comment.model'
import { ReportSectionModel } from '../models/report-section.model'
import type { ISite } from '../models/site.model'
import { opensAssessment } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { assessmentToDraft } from './section.service'

// Limits, well above any real comment or thread.
export const MAX_COMMENT_LENGTH = 5000
export const MAX_QUOTE_LENGTH = 10_000
export const MAX_CONTEXT_LENGTH = 64
export const MAX_COMMENTS = 500

export class CannotOpenAssessmentError extends Error {
  constructor() {
    super("Only the assessment's assigned engineer and knowledge admins can open its report.")
    this.name = 'CannotOpenAssessmentError'
  }
}
export class ThreadNotFoundError extends Error {
  constructor() {
    super('That comment thread no longer exists. Reload the comments to see the latest.')
    this.name = 'ThreadNotFoundError'
  }
}
export class CommentNotFoundError extends Error {
  constructor() {
    super('That comment no longer exists. Reload the comments to see the latest.')
    this.name = 'CommentNotFoundError'
  }
}
export class NotYourCommentError extends Error {
  constructor() {
    super('Only its author can change or delete a comment.')
    this.name = 'NotYourCommentError'
  }
}
export class ThreadFullError extends Error {
  constructor() {
    super(`A thread holds up to ${MAX_COMMENTS} comments. Resolve this one and start a new thread.`)
    this.name = 'ThreadFullError'
  }
}

const anchorSchema = z
  .strictObject({
    sectionId: z.string('Name a section of the report.').regex(SECTION_ID, 'Name a section.'),
    start: z.number().int().min(0).max(1_000_000),
    end: z.number().int().min(1).max(1_000_000),
    exact: z
      .string('Quote the text the comment is on.')
      .min(1, 'Quote the text the comment is on.')
      .max(
        MAX_QUOTE_LENGTH,
        `Comment on ${MAX_QUOTE_LENGTH.toLocaleString('en-GB')} characters of text or fewer.`,
      ),
    prefix: z.string().max(MAX_CONTEXT_LENGTH),
    suffix: z.string().max(MAX_CONTEXT_LENGTH),
  })
  .refine((a) => a.end - a.start === a.exact.length, {
    message: 'The quote does not match the place it is from.',
    path: ['exact'],
  })

const bodySchema = z
  .string('Write a comment.')
  .trim()
  .min(1, 'Write a comment.')
  .max(
    MAX_COMMENT_LENGTH,
    `A comment must be ${MAX_COMMENT_LENGTH.toLocaleString('en-GB')} characters or fewer.`,
  )

// A new thread: where it is, and its first comment.
export const newThreadSchema = z.strictObject({ anchor: anchorSchema, body: bodySchema })
// A reply, or a comment as edited.
export const commentInputSchema = z.strictObject({ body: bodySchema })
// Where the document editor's last save left each thread (AC6): the anchor
// in the section's saved text, or null once the text is deleted entirely.
export const anchorsSchema = z.strictObject({
  anchors: z
    .array(
      z.strictObject({
        id: z.string().refine(isValidObjectId, 'Name a thread.'),
        anchor: anchorSchema.nullable(),
      }),
    )
    .max(1000),
})
export type NewThreadInput = z.infer<typeof newThreadSchema>
export type CommentInput = z.infer<typeof commentInputSchema>
export type AnchorsInput = z.infer<typeof anchorsSchema>

export type CommentDto = {
  id: string
  body: string
  by: Stamp
  at: Date
  editedAt: Date | null
  // The thread's first comment, deleted while others reply to it.
  deleted: boolean
}
export type ThreadDto = {
  id: string
  anchor: ICommentAnchor
  detached: boolean
  status: ThreadStatus
  resolved: { by: Stamp; at: Date } | null
  comments: CommentDto[]
  createdBy: Stamp
  createdAt: Date
  updatedAt: Date
}

type StoredThread = IReportCommentThread & { _id: Types.ObjectId }

const stampOf = (s: Stamp): Stamp => ({ id: s.id, name: s.name })

function toCommentDto(c: IReportComment): CommentDto {
  return {
    id: String(c._id),
    body: c.deletedAt ? '' : c.body,
    by: stampOf(c.by),
    at: c.at,
    editedAt: c.editedAt ?? null,
    deleted: !!c.deletedAt,
  }
}

export function toThreadDto(t: StoredThread): ThreadDto {
  const { sectionId, start, end, exact, prefix, suffix } = t.anchor
  return {
    id: String(t._id),
    anchor: { sectionId, start, end, exact, prefix: prefix ?? '', suffix: suffix ?? '' },
    detached: !!t.detached,
    status: t.status,
    resolved: t.resolved?.by ? { by: stampOf(t.resolved.by), at: t.resolved.at } : null,
    comments: t.comments.map(toCommentDto),
    createdBy: stampOf(t.createdBy),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

type Opened = {
  _id: Types.ObjectId
  engineer?: Types.ObjectId
  archivedAt?: Date
  site: Pick<ISite, 'jurisdiction' | 'facilityType'> | null
}

// The assessment, when the user can open it; to write, it must not be archived.
async function openedAssessment(
  reference: string,
  user: SessionUser,
  write: boolean,
): Promise<Opened> {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt site')
    .populate<{ site: Opened['site'] }>('site', 'jurisdiction facilityType')
    .lean<Opened>()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (!opensAssessment(user, assessment.engineer)) throw new CannotOpenAssessmentError()
  if (write && assessment.archivedAt) throw new AssessmentArchivedError(reference)
  return assessment
}

async function threadOf(assessment: Types.ObjectId, threadId: string): Promise<StoredThread> {
  if (!isValidObjectId(threadId)) throw new ThreadNotFoundError()
  const thread = await ReportCommentThreadModel.findOne({
    _id: threadId,
    assessment,
  }).lean<StoredThread>()
  if (!thread) throw new ThreadNotFoundError()
  return thread
}

// The section draft's category, for the thread's metadata; 'all' without one.
async function copeOf(assessment: Types.ObjectId, sectionId: string) {
  const draft = await ReportSectionModel.findOne(
    { assessment, sectionId },
    { 'metadata.COPE_dimension': 1 },
  )
    .sort({ createdAt: -1 })
    .lean<{ metadata?: { COPE_dimension?: CopeDimension | 'all' } }>()
  return draft?.metadata?.COPE_dimension ?? 'all'
}

// Every thread on the report, oldest first (AC8 orders them by report).
export async function listThreads(
  reference: string,
  user: SessionUser,
): Promise<{ threads: ThreadDto[] }> {
  const assessment = await openedAssessment(reference, user, false)
  const threads = await ReportCommentThreadModel.find({ assessment: assessment._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean<StoredThread[]>()
  return { threads: threads.map(toThreadDto) }
}

// Starts a thread on a passage (AC1) with its first comment.
export async function createThread(
  reference: string,
  input: NewThreadInput,
  user: SessionUser,
): Promise<{ thread: ThreadDto }> {
  const assessment = await openedAssessment(reference, user, true)
  const at = new Date()
  const author = { id: user.id, name: user.name }
  const [created] = await ReportCommentThreadModel.create([
    {
      assessment: assessment._id,
      anchor: input.anchor,
      comments: [{ body: input.body, by: author, at }],
      createdBy: author,
      metadata: {
        source_type: 'report_comment_thread',
        jurisdiction: assessment.site?.jurisdiction ?? 'Unknown',
        facility_type: assessment.site?.facilityType ?? 'Unknown',
        COPE_dimension: await copeOf(assessment._id, input.anchor.sectionId),
        effective_date: at,
      },
    },
  ])
  return { thread: toThreadDto(created.toObject() as StoredThread) }
}

// Adds a reply under the thread, after the comments before it (AC2).
export async function replyTo(
  reference: string,
  threadId: string,
  input: CommentInput,
  user: SessionUser,
): Promise<{ thread: ThreadDto }> {
  const assessment = await openedAssessment(reference, user, true)
  const thread = await threadOf(assessment._id, threadId)
  if (thread.comments.length >= MAX_COMMENTS) throw new ThreadFullError()
  const updated = await ReportCommentThreadModel.findOneAndUpdate(
    { _id: thread._id },
    {
      $push: {
        comments: {
          body: input.body,
          by: { id: user.id, name: user.name },
          at: new Date(),
        },
      },
    },
    { returnDocument: 'after' },
  ).lean<StoredThread>()
  if (!updated) throw new ThreadNotFoundError()
  return { thread: toThreadDto(updated) }
}

// A comment of the caller's, found in its thread (AC3): anyone else's is 403.
function ownComment(thread: StoredThread, commentId: string, user: SessionUser) {
  const index = thread.comments.findIndex((c) => String(c._id) === commentId)
  const comment = thread.comments[index]
  if (!comment || comment.deletedAt) throw new CommentNotFoundError()
  if (comment.by.id !== user.id) throw new NotYourCommentError()
  return { comment, index }
}

// Changes the caller's own comment (AC3); a changed one is marked edited.
export async function editComment(
  reference: string,
  threadId: string,
  commentId: string,
  input: CommentInput,
  user: SessionUser,
): Promise<{ thread: ThreadDto }> {
  const assessment = await openedAssessment(reference, user, true)
  const thread = await threadOf(assessment._id, threadId)
  const { comment } = ownComment(thread, commentId, user)
  if (input.body === comment.body) return { thread: toThreadDto(thread) }
  const updated = await ReportCommentThreadModel.findOneAndUpdate(
    { _id: thread._id, 'comments._id': comment._id },
    {
      $set: {
        'comments.$.body': input.body,
        'comments.$.editedAt': new Date(),
      },
    },
    { returnDocument: 'after' },
  ).lean<StoredThread>()
  if (!updated) throw new CommentNotFoundError()
  return { thread: toThreadDto(updated) }
}

// Deletes the caller's own comment (AC3). A reply goes from the thread; the
// first comment, while others reply to it, reads "Comment deleted"; a
// thread left with no comment goes too (null).
export async function deleteComment(
  reference: string,
  threadId: string,
  commentId: string,
  user: SessionUser,
): Promise<{ thread: ThreadDto | null }> {
  const assessment = await openedAssessment(reference, user, true)
  const thread = await threadOf(assessment._id, threadId)
  const { comment, index } = ownComment(thread, commentId, user)
  const others = thread.comments.filter((c, i) => i !== index && !c.deletedAt)
  if (!others.length) {
    await ReportCommentThreadModel.deleteOne({ _id: thread._id })
    return { thread: null }
  }
  const updated = await ReportCommentThreadModel.findOneAndUpdate(
    { _id: thread._id, 'comments._id': comment._id },
    index === 0
      ? {
          $set: {
            'comments.$.body': '',
            'comments.$.deletedAt': new Date(),
          },
        }
      : { $pull: { comments: { _id: comment._id } } },
    { returnDocument: 'after' },
  ).lean<StoredThread>()
  if (!updated) throw new CommentNotFoundError()
  return { thread: toThreadDto(updated) }
}

// Resolves a thread, or reopens a resolved one (AC5). Already so: unchanged.
export async function setThreadStatus(
  reference: string,
  threadId: string,
  status: ThreadStatus,
  user: SessionUser,
): Promise<{ thread: ThreadDto }> {
  const assessment = await openedAssessment(reference, user, true)
  const thread = await threadOf(assessment._id, threadId)
  if (thread.status === status) return { thread: toThreadDto(thread) }
  const updated = await ReportCommentThreadModel.findOneAndUpdate(
    { _id: thread._id },
    {
      $set:
        status === 'resolved'
          ? { status, resolved: { by: { id: user.id, name: user.name }, at: new Date() } }
          : { status, resolved: null },
    },
    { returnDocument: 'after' },
  ).lean<StoredThread>()
  if (!updated) throw new ThreadNotFoundError()
  return { thread: toThreadDto(updated) }
}

// Where the document editor's save left each thread (AC6): on what remains
// of its text, or detached once that text is deleted entirely, still quoting
// it. Only the assigned engineer saves the text, so only they move anchors;
// a thread no longer on the assessment is skipped.
export async function moveAnchors(
  reference: string,
  input: AnchorsInput,
  user: SessionUser,
): Promise<{ updated: number }> {
  const assessment = await assessmentToDraft(reference, user)
  if (!input.anchors.length) return { updated: 0 }
  const result = await ReportCommentThreadModel.bulkWrite(
    input.anchors.map(({ id, anchor }) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id), assessment: assessment._id },
        update: anchor ? { $set: { anchor, detached: false } } : { $set: { detached: true } },
      },
    })),
  )
  return { updated: result.matchedCount }
}

// How many threads are still open, for the export's reminder (EX-01, RV-03
// AC9). It never blocks the export.
export async function openThreadCount(reference: string): Promise<number> {
  const assessment = await AssessmentModel.findOne({ reference }, '_id').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return await ReportCommentThreadModel.countDocuments({
    assessment: assessment._id,
    status: 'open',
  })
}
