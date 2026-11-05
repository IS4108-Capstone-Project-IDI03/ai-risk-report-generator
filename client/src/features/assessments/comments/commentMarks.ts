// Comment threads in the document editor (RV-03). Each thread's passage
// carries a mark naming the thread, so the thread moves with its words as
// they are edited, stays on what remains of them (AC6), and comes back with
// them on undo. The mark is the editor's alone: it is never saved with the
// text (convert.ts saves only bold, italic and underline), never taken from
// pasted HTML, and never in the export, whose editor does not know it. It is
// placed and removed outside the undo history.
//
// The highlight is a decoration, drawn only on open threads' passages (and
// on the thread being looked at), so resolving one removes it (AC5) while
// its place is kept for reopening; a new thread's passage is highlighted
// while its first comment is written (AC1).
import { Extension, Mark } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export const COMMENT_MARK = 'commentAnchor'

type Range = { from: number; to: number }
export type ThreadRange = Range & { sectionId: string }

// Where each thread's passage is, by thread id: from its first marked
// character to its last, in the first section it is in.
export function threadRanges(doc: PMNode): Map<string, ThreadRange> {
  const ranges = new Map<string, ThreadRange>()
  doc.forEach((section, offset) => {
    const sectionId = section.attrs.id as string
    section.descendants((node, pos) => {
      if (!node.isInline) return true
      for (const mark of node.marks) {
        if (mark.type.name !== COMMENT_MARK) continue
        const id = mark.attrs.id as string
        const from = offset + 1 + pos
        const to = from + node.nodeSize
        const known = ranges.get(id)
        if (!known) ranges.set(id, { from, to, sectionId })
        else if (known.sectionId === sectionId) {
          known.from = Math.min(known.from, from)
          known.to = Math.max(known.to, to)
        }
      }
      return false
    })
  })
  return ranges
}

// The threads on the text at a position, innermost first.
function threadsAt(doc: PMNode, pos: number): string[] {
  const $pos = doc.resolve(pos)
  const marks = [...($pos.nodeAfter?.marks ?? []), ...($pos.nodeBefore?.marks ?? [])]
  const ids = [
    ...new Set(marks.filter((m) => m.type.name === COMMENT_MARK).map((m) => m.attrs.id as string)),
  ]
  if (ids.length < 2) return ids
  const ranges = threadRanges(doc)
  const size = (id: string) => {
    const r = ranges.get(id)
    return r ? r.to - r.from : Infinity
  }
  return ids.sort((a, b) => size(a) - size(b))
}

// What the highlight shows: the open threads, the one being looked at, and a
// new thread's passage while its first comment is written.
export type CommentView = {
  visible: ReadonlySet<string>
  active: string | null
  draft: Range | null
}
type CommentState = CommentView & { decorations: DecorationSet }

export const commentsKey = new PluginKey<CommentState>('dmComments')

function decorate(doc: PMNode, view: CommentView): DecorationSet {
  const decorations: Decoration[] = []
  for (const [id, range] of threadRanges(doc)) {
    if (!view.visible.has(id) && view.active !== id) continue
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: view.active === id ? 'dm-comment is-active' : 'dm-comment',
        'data-thread': id,
      }),
    )
  }
  if (view.draft)
    decorations.push(
      Decoration.inline(view.draft.from, view.draft.to, { class: 'dm-comment is-active is-draft' }),
    )
  return DecorationSet.create(doc, decorations)
}

// Changes what the highlight shows.
export function setCommentView(view: EditorView, change: Partial<CommentView>) {
  view.dispatch(view.state.tr.setMeta(commentsKey, change).setMeta('addToHistory', false))
}

// A transaction that only places or removes threads' marks: kept out of the
// undo history, and not a change to the text (the editor neither saves for it
// nor counts it as unsaved).
function anchorOnly(view: EditorView) {
  return view.state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true)
}

// Marks each thread's passage.
export function placeThreads(view: EditorView, placements: (Range & { id: string })[]) {
  const type = view.state.schema.marks[COMMENT_MARK]
  if (!type || !placements.length) return
  const tr = anchorOnly(view)
  for (const { id, from, to } of placements) tr.addMark(from, to, type.create({ id }))
  view.dispatch(tr)
}

// Takes threads' marks off the text, e.g. once a thread is deleted.
export function removeThreads(view: EditorView, ids: string[]) {
  const type = view.state.schema.marks[COMMENT_MARK]
  if (!type || !ids.length) return
  const tr = anchorOnly(view)
  for (const id of ids) tr.removeMark(0, tr.doc.content.size, type.create({ id }))
  view.dispatch(tr)
}

// The passage of a new thread while its first comment is written, as the
// text around it changes; null once there is none.
export function draftRange(view: EditorView): Range | null {
  return commentsKey.getState(view.state)?.draft ?? null
}

const CommentAnchor = Mark.create({
  name: COMMENT_MARK,
  // Typing at either edge of a passage is not part of it; several threads
  // can share a passage.
  inclusive: false,
  excludes: '',
  addAttributes: () => ({ id: { default: '', rendered: false } }),
  parseHTML: () => [],
  renderHTML: () => ['span', { class: 'dm-comment-anchor' }, 0],
})

// The marks and the highlight. `onActivate` is told which thread's text was
// clicked, so its comments can be shown; `onComment` is Comment's keyboard
// shortcut (Ctrl+Alt+M, Cmd+Option+M on a Mac, as in Google Docs).
export const CommentAnchors = Extension.create<{
  onActivate: (threadId: string) => void
  onComment: () => void
}>({
  name: 'commentAnchors',
  addOptions: () => ({ onActivate: () => {}, onComment: () => {} }),
  addExtensions: () => [CommentAnchor],
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        this.options.onComment()
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    const { onActivate } = this.options
    return [
      new Plugin<CommentState>({
        key: commentsKey,
        state: {
          init: (_, state) => {
            const view: CommentView = { visible: new Set(), active: null, draft: null }
            return { ...view, decorations: decorate(state.doc, view) }
          },
          apply: (tr, value) => {
            const change = tr.getMeta(commentsKey) as Partial<CommentView> | undefined
            let draft = value.draft
            if (draft && tr.docChanged) {
              const from = tr.mapping.map(draft.from, 1)
              const to = tr.mapping.map(draft.to, -1)
              draft = to > from ? { from, to } : null
            }
            const next: CommentView = {
              visible: change?.visible ?? value.visible,
              active: change && 'active' in change ? (change.active ?? null) : value.active,
              draft: change && 'draft' in change ? (change.draft ?? null) : draft,
            }
            if (!change && !tr.docChanged) return value
            return { ...next, decorations: decorate(tr.doc, next) }
          },
        },
        props: {
          decorations: (state) => commentsKey.getState(state)?.decorations,
          handleClick: (view, pos) => {
            const state = commentsKey.getState(view.state)
            const shown = threadsAt(view.state.doc, pos).find(
              (id) => state?.visible.has(id) || state?.active === id,
            )
            if (shown) onActivate(shown)
            return false
          },
        },
      }),
    ]
  },
})
