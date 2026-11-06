// The margin beside the report's text (RV-03 AC1): each open thread level
// with its passage, a new thread's first comment being written, and the
// thread chosen, unfolded. Cards that would overlap move down, as in Google
// Docs; the chosen one stays level with its text and those above make room.
import { useLayoutEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { Stamp } from './api'
import { draftRange } from './commentMarks'
import { stack } from './stack'
import { DraftCard, ThreadCard, type ThreadActions } from './ThreadCard'
import { DRAFT, type Comments } from './useComments'

export function CommentMargin({
  editor,
  comments,
  me,
  canComment,
  actions,
}: {
  editor: Editor
  comments: Comments
  me: Stamp
  canComment: boolean
  actions: ThreadActions
}) {
  const root = useRef<HTMLElement>(null)
  const draft = comments.draft && comments.active === DRAFT ? draftRange(editor.view) : null
  const items = comments.entries
    .filter((e) => e.range && (e.thread.status === 'open' || e.thread.id === comments.active))
    .map((e) => ({ id: e.thread.id, from: e.range!.from, entry: e }))
  const placed: { id: string; from: number }[] = [...items]
  if (draft) placed.push({ id: DRAFT, from: draft.from })

  // Where a passage starts on screen, or null where it can't be measured.
  const topOf = (from: number) => {
    try {
      return editor.view.coordsAtPos(from).top
    } catch {
      return null
    }
  }

  // Each card level with its passage, measured after every render (the text,
  // the page layout or a card's size may have changed) and again whenever a
  // card or the margin changes size. Set on the cards directly, so placing
  // them never renders again; the cards are found by their thread.
  useLayoutEffect(() => {
    const margin = root.current
    if (!margin) return
    const slots = new Map(
      [...margin.querySelectorAll<HTMLDivElement>(':scope > .cm-slot')].map((slot) => [
        slot.dataset.thread ?? '',
        slot,
      ]),
    )
    const place = () => {
      const base = margin.getBoundingClientRect().top
      const wanted = placed.map(({ id, from }) => {
        const top = topOf(from)
        return {
          id,
          top: top === null ? 0 : top - base,
          height: slots.get(id)?.offsetHeight ?? 0,
        }
      })
      const tops = stack(wanted, comments.active)
      for (const [id, y] of Object.entries(tops)) {
        const slot = slots.get(id)
        if (slot) slot.style.transform = `translateY(${Math.round(y)}px)`
      }
    }
    place()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => place())
    observer.observe(margin)
    for (const slot of slots.values()) observer.observe(slot)
    return () => observer.disconnect()
  })

  return (
    <aside ref={root} className="cm-margin" aria-label="Comments beside the text">
      {items.map(({ id, entry }) => (
        <div key={id} className="cm-slot" data-thread={id}>
          <ThreadCard
            thread={entry.thread}
            quote={entry.quote}
            active={comments.active === id}
            me={me}
            canComment={canComment}
            actions={actions}
            onActivate={() => comments.activate(id)}
          />
        </div>
      ))}
      {draft && comments.draft && (
        <div className="cm-slot" data-thread={DRAFT}>
          <DraftCard
            quote={comments.draft.exact}
            onPost={comments.postDraft}
            onCancel={comments.cancelDraft}
          />
        </div>
      )}
    </aside>
  )
}
