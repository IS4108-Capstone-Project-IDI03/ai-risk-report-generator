// The comment threads of the report open in the document editor (RV-03):
// reading them, placing each thread on its passage, the thread being looked at, a new thread's first
// comment, replies, edits, deletes, resolving and reopening, and moving each
// thread to where its text is once the document is saved (AC6).
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { toast } from '../../../design-system'
import {
  anchorOfRange,
  commentTarget,
  positionAt,
  quoteOf,
  rangeOf,
  sectionNamed,
  sectionText,
} from './anchor'
import {
  deleteComment,
  editComment,
  listThreads,
  moveAnchors,
  replyToThread,
  setThreadStatus,
  startThread,
  type CommentAnchor,
  type CommentInput,
  type CommentThread,
} from './api'
import {
  draftRange,
  placeThreads,
  removeThreads,
  setCommentView,
  threadRanges,
  type ThreadRange,
} from './commentMarks'

// The new thread's id while its first comment is written.
export const DRAFT = 'draft'

export type CommentFilter = 'open' | 'resolved' | 'all'

export type ThreadEntry = {
  thread: CommentThread
  // Its passage in the editor now; null when it is not in the text.
  range: ThreadRange | null
  // Where it is in the report, to list threads in report order (AC8).
  at: number
  quote: string
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const anchorKey = (thread: CommentThread) =>
  thread.detached ? 'detached' : JSON.stringify(thread.anchor)

export function useComments({
  reference,
  editor,
  canComment,
  canMoveAnchors,
}: {
  reference: string
  editor: Editor | null
  // Starts threads, replies, resolves and reopens: anyone who can open the
  // assessment, on one not archived (AC7).
  canComment: boolean
  // Saves the text, so moves threads with it: the assigned engineer.
  canMoveAnchors: boolean
}) {
  const [threads, setThreads] = useState<CommentThread[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  // A new thread's passage, while its first comment is written.
  const [draft, setDraft] = useState<CommentAnchor | null>(null)
  // The comments list (AC8), or one thread in it.
  const [panel, setPanel] = useState<null | 'list' | 'thread'>(null)
  const [filter, setFilter] = useState<CommentFilter>('open')
  // Why a thread could not be started from the keyboard shortcut.
  const [hint, setHint] = useState<string | null>(null)
  // Counts changes to the text, so passages are looked up again.
  const [docTick, setDocTick] = useState(0)
  const [reloads, setReloads] = useState(0)

  // Threads whose passage this editor has marked; tried, found or not; and
  // each thread's anchor as the gateway last had it, to send only changes.
  const placed = useRef(new Set<string>())
  const tried = useRef(new Set<string>())
  const stored = useRef(new Map<string, string>())
  const threadsNow = useRef<CommentThread[]>([])
  useEffect(() => {
    threadsNow.current = threads ?? []
  }, [threads])

  // The threads, as the document opens, and again when the engineer comes
  // back to the window.
  useEffect(() => {
    const controller = new AbortController()
    listThreads(reference, controller.signal).then(
      (list) => {
        setLoadError(null)
        setThreads(list)
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(messageOf(error, 'The comments could not be loaded.'))
      },
    )
    return () => controller.abort()
  }, [reference, reloads])
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'hidden') setReloads((n) => n + 1)
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [])

  // Each thread on its passage: found again in the text as it is now, and
  // a deleted one taken off it.
  useEffect(() => {
    if (!editor || !threads) return
    const present = new Set(threads.map((t) => t.id))
    const gone = [...placed.current].filter((id) => !present.has(id))
    for (const id of gone) placed.current.delete(id)
    removeThreads(editor.view, gone)
    const doc = editor.state.doc
    const marked = threadRanges(doc)
    const placements: { id: string; from: number; to: number }[] = []
    for (const thread of threads) {
      if (!stored.current.has(thread.id)) stored.current.set(thread.id, anchorKey(thread))
      if (tried.current.has(thread.id)) continue
      tried.current.add(thread.id)
      if (marked.has(thread.id)) {
        placed.current.add(thread.id)
        continue
      }
      if (thread.detached) continue
      const range = rangeOf(doc, thread.anchor)
      if (!range) continue
      placements.push({ id: thread.id, ...range })
      placed.current.add(thread.id)
    }
    placeThreads(editor.view, placements)
  }, [editor, threads])

  // Open threads are highlighted, and the one being looked at.
  useEffect(() => {
    if (!editor || !threads) return
    setCommentView(editor.view, {
      visible: new Set(threads.filter((t) => t.status === 'open').map((t) => t.id)),
      active: active === DRAFT ? null : active,
    })
  }, [editor, threads, active])

  // The text changed: passages are looked up again, once a frame.
  useEffect(() => {
    if (!editor) return
    let frame = 0
    const changed = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      // Nothing to move: no thread, and no new one being written.
      if (!transaction.docChanged || frame) return
      if (!threadsNow.current.length && !draftRange(editor.view)) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setDocTick((n) => n + 1)
      })
    }
    editor.on('transaction', changed)
    return () => {
      editor.off('transaction', changed)
      cancelAnimationFrame(frame)
    }
  }, [editor])

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(null), 5000)
    return () => clearTimeout(timer)
  }, [hint])

  // Every thread in report order, with where its passage is now (AC8),
  // read again as the text changes (docTick).
  const doc = editor?.state.doc
  const ranges = doc && threads ? threadRanges(doc) : new Map<string, ThreadRange>()
  const entries: ThreadEntry[] = (threads ?? [])
    .map((thread) => {
      const range = ranges.get(thread.id) ?? null
      let at = Number.MAX_SAFE_INTEGER
      if (range) at = range.from
      else if (doc) {
        const section = sectionNamed(doc, thread.anchor.sectionId)
        if (section) {
          const text = sectionText(section.node, section.at)
          at = text.runs.length
            ? positionAt(text, Math.min(thread.anchor.start, text.text.length))
            : section.at
        }
      }
      return {
        thread,
        range,
        at,
        quote: quoteOf(thread.anchor.exact),
      }
    })
    .sort((a, b) => a.at - b.at || Date.parse(a.thread.createdAt) - Date.parse(b.thread.createdAt))
  const counts = {
    open: entries.filter((e) => e.thread.status === 'open').length,
    resolved: entries.filter((e) => e.thread.status === 'resolved').length,
    all: entries.length,
  }

  const update = (thread: CommentThread) =>
    setThreads((list) => (list ?? []).map((t) => (t.id === thread.id ? thread : t)))

  // Shows a thread's text, scrolled into the middle of the view; or its
  // section, once its text is gone.
  const reveal = (sectionId: string, range: ThreadRange | null) => {
    if (!editor) return
    const smooth =
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let target: Element | null = null
    if (range) {
      try {
        const { node } = editor.view.domAtPos(range.from)
        target = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
      } catch {
        target = null
      }
    }
    target ??= document.getElementById(`dm-section-${sectionId}`)
    target?.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  }

  // Chooses a thread from the comments list (AC8):
  // its text scrolls into view, and the thread opens in the margin
  // (`inMargin`, where there is one) or in the list's place. Its passage is
  // read from the text as it is now, marked or not.
  const choose = (id: string, inMargin: boolean) => {
    const thread = threads?.find((t) => t.id === id)
    if (!thread) return
    const range = editor ? (threadRanges(editor.state.doc).get(id) ?? null) : null
    setActive(id)
    reveal(thread.anchor.sectionId, range)
    setPanel(range && inMargin ? null : 'thread')
  }

  // Starts a thread on the selected text (AC1), or says why it cannot.
  const startDraft = (): boolean => {
    if (!editor || !canComment) return false
    const { from, to } = editor.state.selection
    const target = commentTarget(editor.state.doc, from, to)
    if ('reason' in target) {
      setHint(target.reason.text)
      return false
    }
    setHint(null)
    setDraft(target.anchor)
    setActive(DRAFT)
    setCommentView(editor.view, { draft: { from, to } })
    return true
  }
  const cancelDraft = () => {
    setDraft(null)
    setActive((a) => (a === DRAFT ? null : a))
    if (editor) setCommentView(editor.view, { draft: null })
  }

  // Posts the new thread's first comment; its passage is then marked where
  // the text now has it. A problem is returned for the composer to show.
  const postDraft = async (input: CommentInput): Promise<string | null> => {
    if (!editor || !draft) return 'Select the text to comment on.'
    const before = draftRange(editor.view)
    const anchor = (before && anchorOfRange(editor.state.doc, before.from, before.to)) ?? draft
    try {
      const thread = await startThread(reference, { ...input, anchor })
      tried.current.add(thread.id)
      stored.current.set(thread.id, anchorKey(thread))
      // Marked where its passage now is, unless the document was left meanwhile.
      if (!editor.isDestroyed) {
        const range = draftRange(editor.view)
        if (range) {
          placeThreads(editor.view, [{ id: thread.id, ...range }])
          placed.current.add(thread.id)
        }
        setCommentView(editor.view, { draft: null })
      }
      setThreads((list) => [...(list ?? []), thread])
      setDraft(null)
      setActive(thread.id)
      toast.success('Comment posted')
      return null
    } catch (error: unknown) {
      return messageOf(error, 'The comment was not posted. Try again.')
    }
  }

  const reply = async (threadId: string, input: CommentInput): Promise<string | null> => {
    try {
      update(await replyToThread(reference, threadId, input))
      toast.success('Reply posted')
      return null
    } catch (error: unknown) {
      return messageOf(error, 'The reply was not posted. Try again.')
    }
  }

  const edit = async (
    threadId: string,
    commentId: string,
    input: CommentInput,
  ): Promise<string | null> => {
    try {
      update(await editComment(reference, threadId, commentId, input))
      toast.success('Comment updated')
      return null
    } catch (error: unknown) {
      return messageOf(error, 'The comment was not changed. Try again.')
    }
  }

  const remove = async (threadId: string, commentId: string): Promise<boolean> => {
    try {
      const left = await deleteComment(reference, threadId, commentId)
      if (left) update(left)
      else {
        setThreads((list) => (list ?? []).filter((t) => t.id !== threadId))
        setActive((a) => (a === threadId ? null : a))
        setPanel((p) => (p === 'thread' ? 'list' : p))
      }
      toast.success(left ? 'Comment deleted' : 'Comment thread deleted')
      return true
    } catch (error: unknown) {
      toast.error('The comment was not deleted', {
        description: messageOf(error, 'Try again.'),
      })
      return false
    }
  }

  // Resolves a thread: it leaves the margin and its highlight goes (AC5).
  // Reopened, it comes back.
  const setStatus = async (threadId: string, action: 'resolve' | 'reopen') => {
    try {
      const thread = await setThreadStatus(reference, threadId, action)
      update(thread)
      if (action === 'resolve') {
        setActive((a) => (a === threadId ? null : a))
        setPanel((p) => (p === 'thread' ? 'list' : p))
        toast.success('Thread resolved')
      } else {
        setActive(threadId)
        toast.success('Thread reopened')
      }
    } catch (error: unknown) {
      toast.error(
        action === 'resolve' ? 'The thread was not resolved' : 'The thread was not reopened',
        { description: messageOf(error, 'Try again.') },
      )
    }
  }

  // After the document saves: each thread whose passage moved, or whose text
  // was deleted entirely, is saved where it now is (AC6). Threads in a
  // section with changes still to save wait for that save.
  const syncAnchors = async (pending: ReadonlySet<string>) => {
    if (!editor || !canMoveAnchors) return
    const doc = editor.state.doc
    const ranges = threadRanges(doc)
    const changes: { id: string; anchor: CommentAnchor | null; key: string }[] = []
    for (const thread of threadsNow.current) {
      if (!placed.current.has(thread.id)) continue
      const range = ranges.get(thread.id)
      const anchor = range ? anchorOfRange(doc, range.from, range.to) : null
      if (pending.has(thread.anchor.sectionId) || (anchor && pending.has(anchor.sectionId)))
        continue
      const key = anchor ? JSON.stringify(anchor) : 'detached'
      if (stored.current.get(thread.id) === key) continue
      changes.push({ id: thread.id, anchor, key })
    }
    if (!changes.length) return
    try {
      await moveAnchors(
        reference,
        changes.map(({ id, anchor }) => ({ id, anchor })),
      )
    } catch {
      // Sent again after the next save.
      return
    }
    for (const { id, key } of changes) stored.current.set(id, key)
    const moved = new Map(changes.map((c) => [c.id, c.anchor]))
    setThreads((list) =>
      (list ?? []).map((t) => {
        if (!moved.has(t.id)) return t
        const anchor = moved.get(t.id)
        return anchor ? { ...t, anchor, detached: false } : { ...t, detached: true }
      }),
    )
  }

  return {
    threads,
    loadError,
    reload: () => setReloads((n) => n + 1),
    entries,
    counts,
    filter,
    setFilter,
    active,
    // Looks at a thread, or none.
    activate: setActive,
    choose,
    draft,
    startDraft,
    cancelDraft,
    postDraft,
    // A short note under the toolbar, e.g. why a thread could not be started.
    hint,
    tell: setHint,
    reply,
    edit,
    remove,
    resolve: (id: string) => setStatus(id, 'resolve'),
    reopen: (id: string) => setStatus(id, 'reopen'),
    panel,
    setPanel,
    docTick,
    syncAnchors,
  }
}

export type Comments = ReturnType<typeof useComments>
