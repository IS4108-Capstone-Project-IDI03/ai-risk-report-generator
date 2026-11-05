// Gateway calls for comment threads on the report (RV-03); see
// server/src/routes/comment.routes.ts.
import { request } from '../api'

export type Stamp = { id: string; name: string }

// Where in a section a thread is: offsets into the section's text as
// anchor.ts reads it, the text between them, and the text either side.
export type CommentAnchor = {
  sectionId: string
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

export type ReportComment = {
  id: string
  body: string
  by: Stamp
  at: string
  editedAt: string | null
  // The thread's first comment, deleted while others reply to it.
  deleted: boolean
}

export type CommentThread = {
  id: string
  anchor: CommentAnchor
  // Its text was deleted entirely (AC6): only in the comments list now.
  detached: boolean
  status: 'open' | 'resolved'
  resolved: { by: Stamp; at: string } | null
  comments: ReportComment[]
  createdBy: Stamp
  createdAt: string
  updatedAt: string
}

const base = (reference: string) => `/api/assessments/${encodeURIComponent(reference)}/comments`
const threadPath = (reference: string, threadId: string) =>
  `${base(reference)}/${encodeURIComponent(threadId)}`

// Only a list from the gateway counts, so an older one reads as no threads.
export async function listThreads(
  reference: string,
  signal?: AbortSignal,
): Promise<CommentThread[]> {
  const { data } = await request<{ threads?: CommentThread[] }>(
    'GET',
    base(reference),
    undefined,
    signal,
  )
  return Array.isArray(data?.threads) ? data.threads : []
}

export type CommentInput = { body: string }

type Written = { thread: CommentThread }

export async function startThread(
  reference: string,
  input: CommentInput & { anchor: CommentAnchor },
): Promise<CommentThread> {
  return (await request<Written>('POST', base(reference), input)).data.thread
}

export async function replyToThread(
  reference: string,
  threadId: string,
  input: CommentInput,
): Promise<CommentThread> {
  return (await request<Written>('POST', `${threadPath(reference, threadId)}/replies`, input)).data
    .thread
}

export async function editComment(
  reference: string,
  threadId: string,
  commentId: string,
  input: CommentInput,
): Promise<CommentThread> {
  return (
    await request<Written>(
      'PATCH',
      `${threadPath(reference, threadId)}/comments/${encodeURIComponent(commentId)}`,
      input,
    )
  ).data.thread
}

// The thread as it is left, or null once its last comment is gone.
export async function deleteComment(
  reference: string,
  threadId: string,
  commentId: string,
): Promise<CommentThread | null> {
  return (
    await request<{ thread: CommentThread | null }>(
      'DELETE',
      `${threadPath(reference, threadId)}/comments/${encodeURIComponent(commentId)}`,
    )
  ).data.thread
}

export async function setThreadStatus(
  reference: string,
  threadId: string,
  action: 'resolve' | 'reopen',
): Promise<CommentThread> {
  return (
    await request<{ thread: CommentThread }>('POST', `${threadPath(reference, threadId)}/${action}`)
  ).data.thread
}

// Where the document editor's last save left each thread (AC6).
export async function moveAnchors(
  reference: string,
  anchors: { id: string; anchor: CommentAnchor | null }[],
): Promise<void> {
  await request('PUT', `${base(reference)}/anchors`, { anchors })
}
