// One comment thread (RV-03): its comments oldest first, each with its
// author and time and marked Edited once changed (AC2, AC3); a reply box;
// and Resolve, or Reopen once resolved (AC5). Only a comment's author is
// offered Edit and Delete on it (AC3). Folded in the margin until chosen, it
// shows its first comment and how many replies follow.
import { useState } from 'react'
import { Button, Icon, IconButton } from '../../../design-system'
import { formatDayTime } from '../format'
import type { CommentInput, CommentThread, ReportComment, Stamp } from './api'
import { CommentComposer } from './CommentComposer'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

// A comment's words, line breaks kept.
export function CommentBody({ body }: { body: string }) {
  return <p className="cm-body">{body}</p>
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="cm-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  )
}

function Byline({ comment }: { comment: ReportComment }) {
  return (
    <span className="cm-who">
      <span className="cm-name">{comment.by.name}</span>
      <span className="cm-when">
        <time dateTime={comment.at}>{formatDayTime(new Date(comment.at))}</time>
        {comment.editedAt && <span className="cm-edited"> · Edited</span>}
      </span>
    </span>
  )
}

export type ThreadActions = {
  reply: (threadId: string, input: CommentInput) => Promise<string | null>
  edit: (threadId: string, commentId: string, input: CommentInput) => Promise<string | null>
  remove: (threadId: string, commentId: string) => Promise<boolean>
  resolve: (threadId: string) => Promise<void>
  reopen: (threadId: string) => Promise<void>
}

function CommentItem({
  thread,
  comment,
  me,
  canComment,
  actions,
}: {
  thread: CommentThread
  comment: ReportComment
  me: Stamp
  canComment: boolean
  actions: ThreadActions
}) {
  const [mode, setMode] = useState<'read' | 'edit' | 'confirm'>('read')
  const [deleting, setDeleting] = useState(false)
  const own = comment.by.id === me.id && canComment && !comment.deleted
  return (
    <div className="cm-comment">
      <div className="cm-comment-head">
        <Avatar name={comment.by.name} />
        <Byline comment={comment} />
        {own && mode === 'read' && (
          <span className="cm-comment-actions">
            <IconButton
              icon="pencil"
              size="sm"
              label="Edit comment"
              onClick={() => setMode('edit')}
            />
            <IconButton
              icon="trash-2"
              size="sm"
              label="Delete comment"
              style={{ color: 'var(--red-600)' }}
              onClick={() => setMode('confirm')}
            />
          </span>
        )}
      </div>
      {comment.deleted ? (
        <p className="cm-body is-deleted">Comment deleted</p>
      ) : mode === 'edit' ? (
        <CommentComposer
          label="Edit comment"
          submitLabel="Save"
          initial={comment.body}
          autoFocus
          onCancel={() => setMode('read')}
          onSubmit={async (input) => {
            const problem = await actions.edit(thread.id, comment.id, input)
            if (!problem) setMode('read')
            return problem
          }}
        />
      ) : (
        <CommentBody body={comment.body} />
      )}
      {mode === 'confirm' && (
        <div className="cm-confirm" role="group" aria-label="Delete this comment?">
          <p>
            {thread.comments.filter((c) => !c.deleted).length === 1
              ? 'Delete this comment? The thread goes with it.'
              : 'Delete this comment?'}
          </p>
          <div className="cm-composer-actions">
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setMode('read')}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              pill
              loading={deleting}
              onClick={async () => {
                setDeleting(true)
                const done = await actions.remove(thread.id, comment.id)
                setDeleting(false)
                if (done) setMode('read')
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ThreadCard({
  thread,
  quote,
  showQuote = false,
  gone = false,
  active,
  me,
  canComment,
  actions,
  onActivate,
}: {
  thread: CommentThread
  quote: string
  // Shown in the comments list, where the text is not beside it.
  showQuote?: boolean
  // Its text is no longer in the report (AC6).
  gone?: boolean
  // Chosen: unfolded, with the reply box.
  active: boolean
  me: Stamp
  canComment: boolean
  actions: ThreadActions
  onActivate?: () => void
}) {
  const resolved = thread.status === 'resolved'
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  const className = `cm-card${active ? ' is-active' : ''}${resolved ? ' is-resolved' : ''}`
  const label = `Comment thread on “${quote}”`

  if (!active && onActivate)
    return (
      <article className={className} aria-label={label}>
        <button type="button" className="cm-card-summary" onClick={onActivate}>
          {first && (
            <>
              <span className="cm-comment-head">
                <Avatar name={first.by.name} />
                <Byline comment={first} />
              </span>
              {first.deleted ? (
                <span className="cm-body is-deleted">Comment deleted</span>
              ) : (
                <span className="cm-body cm-clamp">{first.body}</span>
              )}
            </>
          )}
          {replies > 0 && (
            <span className="cm-more">
              {replies} {replies === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </button>
      </article>
    )

  return (
    <article className={className} aria-label={label}>
      <div className="cm-card-top">
        {showQuote ? (
          <blockquote className="cm-quote">{quote}</blockquote>
        ) : (
          <span className="cm-card-label">{resolved ? 'Resolved' : 'Open'}</span>
        )}
        {canComment &&
          (resolved ? (
            <IconButton
              icon="rotate-ccw"
              size="sm"
              label="Reopen thread"
              onClick={() => void actions.reopen(thread.id)}
            />
          ) : (
            <IconButton
              icon="check"
              size="sm"
              label="Resolve thread"
              onClick={() => void actions.resolve(thread.id)}
            />
          ))}
      </div>
      {gone && (
        <p className="cm-gone">
          <Icon name="text-cursor-input" size={14} />
          The text this thread was on is no longer in the report.
        </p>
      )}
      {resolved && thread.resolved && (
        <p className="cm-resolved">
          <Icon name="circle-check" size={14} color="var(--green-600)" />
          Resolved by {thread.resolved.by.name} ·{' '}
          <time dateTime={thread.resolved.at}>{formatDayTime(new Date(thread.resolved.at))}</time>
        </p>
      )}
      <ol className="cm-comments">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <CommentItem
              thread={thread}
              comment={comment}
              me={me}
              canComment={canComment}
              actions={actions}
            />
          </li>
        ))}
      </ol>
      {canComment && !resolved && (
        <CommentComposer
          label="Reply"
          placeholder="Reply"
          submitLabel="Reply"
          onSubmit={(input) => actions.reply(thread.id, input)}
        />
      )}
    </article>
  )
}

// A new thread while its first comment is written (AC1).
export function DraftCard({
  quote,
  onPost,
  onCancel,
  showQuote = false,
}: {
  quote: string
  onPost: (input: CommentInput) => Promise<string | null>
  onCancel: () => void
  showQuote?: boolean
}) {
  return (
    <article className="cm-card is-active is-draft" aria-label="New comment">
      {showQuote && <blockquote className="cm-quote">{quote}</blockquote>}
      <CommentComposer
        label="New comment"
        submitLabel="Comment"
        autoFocus
        onSubmit={onPost}
        onCancel={onCancel}
      />
    </article>
  )
}
