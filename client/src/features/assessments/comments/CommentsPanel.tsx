// The comments list (RV-03 AC8): every thread on the report in report order,
// filtered to the open ones, the resolved ones, or all.
// Choosing one scrolls its text into view and opens it: in the margin
// beside the text where there is room, else here, in the list's place,
// which is also where a thread whose text is gone is read. Where there is no
// margin (a narrow window), new threads and chosen ones open here too.
import { Button, EmptyState, IconButton, SegmentedControl } from '../../../design-system'
import type { DocumentPart } from '../document/sections'
import { quoteOf } from './anchor'
import type { Stamp } from './api'
import { DraftCard, ThreadCard, type ThreadActions } from './ThreadCard'
import { DRAFT, type CommentFilter, type Comments, type ThreadEntry } from './useComments'

const FILTERS: { value: CommentFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const EMPTY: Record<CommentFilter, string> = {
  open: 'No open threads. Select text in the report and choose Comment to start one.',
  resolved: 'No resolved threads.',
  all: 'No comments yet. Select text in the report and choose Comment to start one.',
}

const shows = (filter: CommentFilter) => (e: ThreadEntry) =>
  filter === 'all' ||
  (filter === 'open' ? e.thread.status === 'open' : e.thread.status === 'resolved')

export function CommentsPanel({
  comments,
  parts,
  me,
  canComment,
  actions,
  marginShown,
  overlay,
  onClose,
}: {
  comments: Comments
  parts: DocumentPart[]
  me: Stamp
  canComment: boolean
  actions: ThreadActions
  // Chosen threads with text open in the margin, not here.
  marginShown: boolean
  // Drawn over the document, in a narrow window.
  overlay: boolean
  onClose: () => void
}) {
  const sectionOf = (id: string) => {
    const part = parts.find((p) => p.id === id)
    if (!part) return `Section ${id}`
    return part.id === 'A' ? `Appendix A. ${part.title}` : `${part.number}. ${part.title}`
  }
  const className = overlay ? 'cm-panel is-overlay' : 'cm-panel'
  const activeEntry = comments.entries.find((e) => e.thread.id === comments.active)

  // One thread, or a new thread's first comment, in the list's place.
  if (comments.panel === 'thread' && (activeEntry || comments.active === DRAFT)) {
    return (
      <aside className={className} aria-label="Comments">
        <div className="cm-panel-head">
          <Button
            variant="ghost"
            size="sm"
            iconLeft="chevron-left"
            onClick={() => {
              if (comments.active === DRAFT) comments.cancelDraft()
              comments.setPanel('list')
            }}
          >
            All comments
          </Button>
          <IconButton icon="x" size="sm" label="Close comments" onClick={onClose} />
        </div>
        <div className="cm-panel-body om-scroll">
          {comments.active === DRAFT && comments.draft ? (
            <DraftCard
              showQuote
              quote={quoteOf(comments.draft.exact)}
              onPost={comments.postDraft}
              onCancel={() => {
                comments.cancelDraft()
                comments.setPanel(overlay ? null : 'list')
              }}
            />
          ) : (
            activeEntry && (
              <>
                <p className="cm-section">{sectionOf(activeEntry.thread.anchor.sectionId)}</p>
                <ThreadCard
                  thread={activeEntry.thread}
                  quote={activeEntry.quote}
                  showQuote
                  gone={!activeEntry.range}
                  active
                  me={me}
                  canComment={canComment}
                  actions={actions}
                />
              </>
            )
          )}
        </div>
      </aside>
    )
  }

  const listed = comments.entries.filter(shows(comments.filter))
  return (
    <aside className={className} aria-label="Comments">
      <div className="cm-panel-head">
        <h2 className="cm-panel-title">Comments</h2>
        <IconButton icon="x" size="sm" label="Close comments" onClick={onClose} />
      </div>
      <div className="cm-panel-filter">
        <SegmentedControl
          ariaLabel="Show threads"
          options={FILTERS}
          value={comments.filter}
          onChange={comments.setFilter}
        />
        <p className="cm-panel-count" role="status">
          {comments.counts.open} open · {comments.counts.resolved} resolved
        </p>
      </div>
      <div className="cm-panel-body om-scroll">
        {comments.loadError ? (
          <div className="cm-problem" role="alert">
            <p>{comments.loadError}</p>
            <Button variant="secondary" size="sm" onClick={comments.reload}>
              Try again
            </Button>
          </div>
        ) : !comments.threads ? (
          <p className="cm-panel-note">Loading the comments…</p>
        ) : !listed.length ? (
          <EmptyState
            icon="messages-square"
            title="Nothing here"
            description={EMPTY[comments.filter]}
          />
        ) : (
          <ul className="cm-list" aria-label="Comment threads">
            {listed.map((entry) => {
              const { thread } = entry
              const first = thread.comments.find((c) => !c.deleted) ?? thread.comments[0]
              const replies = thread.comments.length - 1
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="cm-row"
                    aria-current={comments.active === thread.id ? 'true' : undefined}
                    onClick={() => comments.choose(thread.id, marginShown)}
                  >
                    <span className="cm-section">{sectionOf(thread.anchor.sectionId)}</span>
                    <span className="cm-quote cm-clamp">{entry.quote}</span>
                    {first && (
                      <span className="cm-row-comment cm-clamp">
                        <strong>{first.by.name}</strong>{' '}
                        {first.deleted ? 'Comment deleted' : first.body}
                      </span>
                    )}
                    <span className="cm-row-meta">
                      {replies > 0 && `${replies} ${replies === 1 ? 'reply' : 'replies'}`}
                      {thread.status === 'resolved' && <span className="cm-tag">Resolved</span>}
                      {!entry.range && <span className="cm-tag">Text deleted</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
