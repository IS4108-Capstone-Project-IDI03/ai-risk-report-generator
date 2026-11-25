import { useEffect, useMemo, useRef, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Button, Callout, Dialog, IconRegistry, toast } from '../../../design-system'
import type { AcceptedOfi, Assessment, ReviewWorkspace, SavedObservation, Summary } from '../api'
import { AskHighlight, setAskMarks } from '../ask/askHighlight'
import type { AskDrafting } from '../ask/AskPanel'
import { DictationScope } from '../dictation/scope'
import { DocumentAsk } from '../ask/DocumentAsk'
import type { AskGuidanceTarget } from '../ask/AskPanel'
import { editorPassage, type AskPassage } from '../ask/passage'
import { isAskShortcut } from '../ask/shortcut'
import { READ_ONLY, type AskWorkflow } from '../ask/useAsk'
import { rangeOf } from '../comments/anchor'
import type { Stamp } from '../comments/api'
import { CommentAnchors } from '../comments/commentMarks'
import { CommentMargin } from '../comments/CommentMargin'
import { CommentsPanel } from '../comments/CommentsPanel'
import type { ThreadActions } from '../comments/ThreadCard'
import { DRAFT, useComments } from '../comments/useComments'
import { toEditorJSON } from '../document/convert'
import { toggleSubheading } from '../document/commands'
import { DocumentToolbar } from '../document/DocumentToolbar'
import { FindBar } from '../document/FindBar'
import { FindReplace } from '../document/findReplace'
import { DocumentPartsContext } from '../document/parts'
import { ReviewPlugins } from '../document/plugins'
import { contentsEntries, coverDetails, type ContentsEntry } from '../document/page/frontMatter'
import { MARSH_GEOMETRY, pagesHeight, strideOf } from '../document/page/geometry'
import { placeOf, restorePlace, scrollToPage, type Place } from '../document/page/measure'
import { FrontPages, PageBands } from '../document/page/PageFrame'
import { PageLayout, setPageLayout, type PageLayoutState } from '../document/page/PageLayout'
import { documentExtensions } from '../document/schema'
import { buildReportDocument, type ReportDocument } from '../document/sections'
import { useDocumentSave, type SaveStatus } from '../document/useDocumentSave'
import { formatDayTime } from '../format'
import { Tip } from '../../help/Tip'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import { setLeaveGuard } from '../leaveGuard'
import { registerPendingSave } from '../pendingSaves'
import { useSections } from '../useSections'
import '../document/document.css'
import '../document/page/pages.css'
import '../comments/comments.css'
import '../ask/ask.css'

// The sections text is drafted into from the Ask panel (AS-04).
const DRAFTABLE = /^(1[0-2]|[4-9])$/

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Not saved',
  conflict: 'Not saved',
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// None yet: one list for every render, so the document's parts stay the same.
const NO_OBSERVATIONS: SavedObservation[] = []
const NOBODY: Stamp = { id: '', name: '' }

// The bottom of the sticky save bar and toolbar, which the view starts under.
const bottomOf = (element: HTMLElement | null) => element?.getBoundingClientRect().bottom ?? 0

// The room the comment margin needs beside the text (RV-03): the narrowest
// the continuous view's text goes, or the page layout's page, the margin and
// the gaps around them.
const MARGIN_ROOM = { continuous: 560 + 296 + 64, page: 816 + 296 + 64 }

// What the editor's comment marks (RV-03) and Ask's shortcut (AS-02) call
// back to: set once the document has rendered, so the editor, made once,
// always reaches the latest handlers. `ask` says whether it asked.
function createCommentBridge() {
  let activate: (threadId: string) => void = () => {}
  let comment: () => void = () => {}
  let ask: () => boolean = () => false
  return {
    onActivate: (threadId: string) => activate(threadId),
    onComment: () => comment(),
    onAsk: () => ask(),
    set(handlers: {
      activate: (threadId: string) => void
      comment: () => void
      ask: () => boolean
    }) {
      activate = handlers.activate
      comment = handlers.comment
      ask = handlers.ask
    },
  }
}

// The section the selection is in, by its id.
function sectionAtSelection(editor: Editor): string | null {
  const { $from } = editor.state.selection
  return $from.depth >= 1 ? (($from.node(1).attrs.id as string) ?? null) : null
}

// The document editor itself, once everything it shows has loaded.
function DocumentBody({
  reference,
  report,
  parts,
  assessment,
  startAt,
  readOnly,
  canComment,
  me,
  ask,
  onViewObservation,
  onReturn,
  onReload,
  wrapStyle,
  railStyle,
}: {
  reference: string
  report: ReportDocument
  parts: Omit<NonNullable<React.ContextType<typeof DocumentPartsContext>>, 'pageLayout'>
  // The assessment as last read, for the cover and details page (RV-12).
  assessment: Assessment | null
  startAt: string
  // Read only: commented on, not changed (RV-03 AC7).
  readOnly: boolean
  canComment: boolean
  me: Stamp
  // Asking about the selected text (AS-02): the Ask tab's conversation, or null.
  ask: AskWorkflow | null
  // Where writing guidance's Go to observation goes (AS-08).
  onViewObservation?: (id: string | null) => void
  onReturn: (sectionId: string) => void
  onReload: () => void
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
}) {
  const { status, savedAt, problem, saver } = useDocumentSave(
    reference,
    report.parts,
    report.lastSavedAt,
  )
  const [findOpen, setFindOpen] = useState(false)
  const [current, setCurrent] = useState(startAt)
  // Leaving with unsaved changes: where to, once the engineer chooses (AC14).
  const [leaving, setLeaving] = useState<null | { proceed: () => void }>(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const header = useRef<HTMLDivElement>(null)
  // Marsh's page layout (RV-12), the pages it last laid out, and where the
  // engineer was when switching, to come back to (AC1).
  const [pageMode, setPageMode] = useState(false)
  const [layout, setLayout] = useState<PageLayoutState | null>(null)
  const switchedFrom = useRef<Place | null>(null)
  // The editor area's width, for whether the comment margin fits (RV-03).
  const main = useRef<HTMLElement>(null)
  const [mainWidth, setMainWidth] = useState(0)
  const [bridge] = useState(createCommentBridge)
  // The Ask panel (AS-02), and why the selection could not be asked about.
  const [askOpen, setAskOpen] = useState(false)
  const [askHint, setAskHint] = useState<string | null>(null)

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // Read only, the text is not changed, but can still be selected to
    // comment on (RV-03 AC7).
    editable: !readOnly,
    extensions: [
      ...documentExtensions,
      ReviewPlugins.configure({ context: report.context }),
      FindReplace,
      PageLayout.configure({ geometry: MARSH_GEOMETRY, onLayout: setLayout }),
      CommentAnchors.configure({ onActivate: bridge.onActivate, onComment: bridge.onComment }),
      AskHighlight.configure({ onAsk: bridge.onAsk }),
      Extension.create({
        name: 'documentKeys',
        priority: 1000,
        addKeyboardShortcuts: () => ({
          'Mod-f': () => {
            setFindOpen(true)
            return true
          },
          'Mod-s': () => {
            void saver.save()
            return true
          },
          // Keeps each block's finding, unlike TipTap's own (commands.ts).
          'Mod-Alt-4': ({ editor: e }) => toggleSubheading(e),
        }),
      }),
    ],
    content: toEditorJSON(report.sections),
    editorProps: {
      attributes: {
        class: 'dm-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Report document',
      },
    },
    onUpdate: () => {
      if (!readOnly) saver.changedNow()
    },
    onSelectionUpdate: ({ editor: e }) => {
      const id = sectionAtSelection(e)
      if (id) setCurrent(id)
      setAskHint(null)
    },
  })

  // The walkthrough engine (F-12) hears the document has rendered; it is held back while the
  // document has unsaved work, so an offer never lands on someone mid-edit.
  useWalkthroughScreen('document', !!editor, !readOnly && status !== 'saved' && 'unsaved')

  // Saving starts from the document as it opened; read only, nothing saves.
  useEffect(() => {
    if (editor && !readOnly) saver.attach(editor)
  }, [editor, saver, readOnly])

  // Comment threads (RV-03), moved with the text each time it saves (AC6).
  const comments = useComments({
    reference,
    editor,
    canComment,
    canMoveAnchors: !readOnly,
  })
  useEffect(() => saver.listen((pending) => void comments.syncAnchors(pending)))
  // Whether the margin fits beside the text: unmeasured (as in tests), it does.
  useEffect(() => {
    const element = main.current
    if (!element || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(([entry]) => setMainWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const room =
    mainWidth === 0 || mainWidth >= (pageMode ? MARGIN_ROOM.page : MARGIN_ROOM.continuous)
  const inMargin = room && comments.panel === null
  const marginShown =
    inMargin &&
    (comments.active === DRAFT ||
      comments.entries.some(
        (e) => e.range && (e.thread.status === 'open' || e.thread.id === comments.active),
      ))
  // A new thread on the selected text (AC1): in the margin, or in the
  // comments list's place where there is no margin.
  const startComment = () => {
    if (!comments.startDraft()) return
    setAskOpen(false)
    if (!inMargin) comments.setPanel('thread')
  }
  // Each section as the report heads it, for a passage asked about (AS-02).
  const labelOf = (sectionId: string) => {
    const part = report.parts.find((p) => p.id === sectionId)
    if (!part) return `Section ${sectionId}`
    return part.id === 'A' ? `Appendix A. ${part.title}` : `${part.number}. ${part.title}`
  }
  // The Ask panel opens in the comments list's place, so only one is open.
  const openAsk = () => {
    if (comments.active === DRAFT) comments.cancelDraft()
    comments.setPanel(null)
    setAskOpen(true)
  }
  // Ask about this (AS-02 AC1): the selected text goes into the question box
  // of the Ask panel, or the reason it can't is said under the toolbar.
  const askAboutSelection = () => {
    if (!ask || !editor) return
    // An archived assessment's conversations are only read (AS-03 AC5).
    if (ask.archived) {
      setAskHint(`${READ_ONLY.title}. ${READ_ONLY.text}`)
      return
    }
    const { from, to } = editor.state.selection
    const target = editorPassage(editor.state.doc, from, to, labelOf)
    if ('reason' in target) {
      setAskHint(`${target.reason.title}. ${target.reason.text}`)
      return
    }
    setAskHint(null)
    setAskMarks(editor.view, { shown: null })
    ask.setAbout(target.passage)
    openAsk()
  }
  // Rewrite this (AS-04 AC1): as Ask about this, the passage going into the
  // Ask panel to be rewritten. A rewrite starts from the saved text, so the
  // document must be saved first.
  const rewriteSelection = () => {
    if (!ask || !editor || readOnly) return
    if (status !== 'saved') {
      setAskHint(
        'Save the document first. Rewrite this starts from the saved text, so save, then select the text again.',
      )
      return
    }
    const { from, to } = editor.state.selection
    const target = editorPassage(editor.state.doc, from, to, labelOf)
    if ('reason' in target) {
      setAskHint(`${target.reason.title}. ${target.reason.text}`)
      return
    }
    setAskHint(null)
    setAskMarks(editor.view, { shown: null })
    ask.rewrite(target.passage)
    openAsk()
  }
  // Drafting text into the report from the Ask panel (AS-04), for the
  // assigned engineer: into the section the cursor is in, when it is one of
  // Sections 4 to 12. Insert, Replace and Undo build on the saved text, so
  // they wait for unsaved changes to be saved; the document then reopens with
  // the section's new version.
  const drafting: AskDrafting | undefined =
    ask && !readOnly && !ask.archived
      ? {
          target: DRAFTABLE.test(current) ? { sectionId: current, label: labelOf(current) } : null,
          blocked:
            status === 'saved'
              ? undefined
              : {
                  title: 'Unsaved changes',
                  text: 'Save the document first: the text goes in on top of the saved text.',
                },
          onApplied: (_workspace, proposal) => {
            toast.success(
              proposal.status === 'undone'
                ? 'Undone'
                : `${proposal.kind === 'draft' ? 'Inserted into' : 'Replaced in'} ${proposal.label}`,
              {
                description:
                  proposal.status === 'undone'
                    ? `The text before is back in ${proposal.label}.`
                    : 'It stays AI draft until you accept it in the review workspace.',
              },
            )
            onReload()
          },
        }
      : undefined
  // Back to a passage asked about (AC3): marked and scrolled to; the panel
  // steps aside where it covers the text.
  const showAsked = (passage: AskPassage) => {
    if (!editor) return
    const range = rangeOf(editor.state.doc, passage.anchor)
    if (!range) return
    setAskMarks(editor.view, { shown: range })
    const at = editor.view.domAtPos(range.from).node
    const element = at instanceof Element ? at : at.parentElement
    element?.scrollIntoView?.({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
    if (!room) setAskOpen(false)
  }
  // The passage in the question box is marked in the text while it waits
  // there, also when it was chosen in the review workspace.
  const about = ask?.about ?? null
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setAskMarks(editor.view, { pending: about ? rangeOf(editor.state.doc, about.anchor) : null })
  }, [editor, about])
  // A thread's highlighted text clicked: its thread opens.
  useEffect(() =>
    bridge.set({
      activate: (threadId) => {
        comments.activate(threadId)
        setAskOpen(false)
        if (!inMargin) comments.setPanel('thread')
      },
      comment: () => {
        if (canComment) startComment()
      },
      ask: () => {
        if (!ask) return false
        askAboutSelection()
        return true
      },
    }),
  )
  // Read only, the text takes no keys, so Comment's shortcut is the window's.
  useEffect(() => {
    if (!readOnly || !canComment) return
    const press = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'KeyM') {
        event.preventDefault()
        bridge.onComment()
      }
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [readOnly, canComment, bridge])
  // So is Ask about this's (AS-02).
  useEffect(() => {
    if (!readOnly || !ask) return
    const press = (event: KeyboardEvent) => {
      if (!isAskShortcut(event)) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea')) return
      event.preventDefault()
      bridge.onAsk()
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [readOnly, ask, bridge])
  const actions: ThreadActions = {
    reply: comments.reply,
    edit: comments.edit,
    remove: comments.remove,
    resolve: comments.resolve,
    reopen: comments.reopen,
  }

  // Opens on the section being reviewed.
  useEffect(() => {
    document.getElementById(`dm-section-${startAt}`)?.scrollIntoView?.({ block: 'start' })
  }, [startAt])

  // The section in view, for the outline and Return to review, until the
  // engineer clicks into the text. Whatever scrolls the page (its own pane, or
  // the workspace below 1080px), measured from under the sticky header.
  useEffect(() => {
    const follow = () => {
      if (!editor || editor.isFocused) return
      const top = (header.current?.getBoundingClientRect().bottom ?? 0) + 24
      let inView = report.parts[0].id
      for (const part of report.parts) {
        const element = document.getElementById(`dm-section-${part.id}`)
        if (element && element.getBoundingClientRect().top <= top) inView = part.id
      }
      setCurrent(inView)
    }
    document.addEventListener('scroll', follow, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', follow, { capture: true })
  }, [editor, report.parts])

  // Switching between the continuous view and the page layout keeps the
  // engineer's place (RV-12 AC1): the text at the top of the view stays there.
  const switchView = () => {
    if (!editor) return
    switchedFrom.current = placeOf(editor.view, bottomOf(header.current))
    const next = !pageMode
    setPageMode(next)
    setPageLayout(editor, next)
  }
  useEffect(() => {
    const place = switchedFrom.current
    if (!place || !editor) return
    // The page layout first measures the pages.
    if (pageMode && !layout?.measured) return
    switchedFrom.current = null
    const frame = requestAnimationFrame(() =>
      restorePlace(editor.view, place, bottomOf(header.current)),
    )
    return () => cancelAnimationFrame(frame)
  }, [pageMode, layout, editor])

  // A page of the report at the top of the view (RV-12): where a section or
  // a contents entry starts.
  const goToPage = (page: number) => {
    if (editor && layout)
      scrollToPage(
        editor.view,
        page * strideOf(MARSH_GEOMETRY),
        layout.scale,
        bottomOf(header.current),
      )
  }

  const goTo = (id: string) => {
    setCurrent(id)
    const opening = layout?.headings.find((h) => h.sectionId === id && h.level === 1)
    if (pageMode && opening) {
      goToPage(opening.page)
      return
    }
    document
      .getElementById(`dm-section-${id}`)
      ?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  // Leaving with unsaved changes asks first (AC14): for Return to review, a
  // locked part's link, another tab or screen.
  const attemptLeave = (proceed: () => void) => {
    if (saver.dirty()) setLeaving({ proceed })
    else proceed()
  }
  // An export saves the document's pending changes first (EX-01 AC1).
  useEffect(
    () => registerPendingSave(async () => (saver.dirty() ? await saver.save() : true)),
    [saver],
  )
  useEffect(
    () =>
      setLeaveGuard((proceed) => {
        if (!saver.dirty()) return false
        setLeaving({ proceed })
        return true
      }),
    [saver],
  )
  // Leaving the page: the browser asks (AC14).
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!saver.dirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saver])

  const returnToReview = () => attemptLeave(() => onReturn(current))
  const located = useMemo(
    () => ({
      ...parts,
      pageLayout: pageMode,
      onOpen: (id: string) => {
        if (saver.dirty()) setLeaving({ proceed: () => onReturn(id) })
        else onReturn(id)
      },
    }),
    [parts, saver, onReturn, pageMode],
  )
  const details = coverDetails(assessment)
  const contents = layout ? contentsEntries(report.parts, layout.headings) : null
  const openEntry = (entry: ContentsEntry) => {
    setCurrent(entry.sectionId)
    goToPage(entry.page - 1)
  }
  // Writing guidance for the section the cursor is in (AS-08): Go to section
  // scrolls to it here; Go to observation opens it on the Observations tab,
  // asking first if there are unsaved changes (the leave guard).
  const guidance: AskGuidanceTarget = {
    target: { sectionId: current, label: labelOf(current) },
    onGo: (link) => {
      if (link.to === 'section') goTo(link.sectionId)
      else onViewObservation?.(link.observationId)
    },
  }

  if (!editor) return null
  return (
    <DocumentPartsContext.Provider value={located}>
      <div style={wrapStyle} className="dm-wrap">
        <nav aria-label="Document outline" className="om-scroll dm-outline" style={railStyle}>
          <p className="rv-label rv-rail-head">Outline</p>
          <ol className="dm-outline-list">
            {report.parts.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  className="rv-rail-row"
                  aria-current={current === part.id ? 'true' : undefined}
                  onClick={() => goTo(part.id)}
                >
                  <span className="rv-rail-number">{part.number}</span>
                  <span className="rv-rail-body">
                    <span className="rv-rail-title">{part.title}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="rv-rail-legend">
            {readOnly
              ? 'You can read the whole report and comment on any part of it. Only its assigned engineer changes the text.'
              : 'Headings and parts filled in elsewhere stay as they are. Violet text is still as the draft wrote it; once you change it, it is yours. Changes save when you pause.'}
          </p>
        </nav>
        <section
          aria-label="Document editor"
          className="dm-main"
          ref={main}
          data-walk="document.page"
        >
          <div className="dm-head" ref={header}>
            <div className="dm-bar">
              <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={returnToReview}>
                Return to review
              </Button>
              <div className="dm-save-row">
                <p className="dm-save-status" role="status">
                  {readOnly ? (
                    'Read only · You can comment and reply'
                  ) : (
                    <>
                      {STATUS_TEXT[status]}
                      {savedAt && status !== 'saving' && (
                        <span className="dm-save-time">
                          {' '}
                          · Last saved {formatDayTime(new Date(savedAt))}
                        </span>
                      )}
                    </>
                  )}
                </p>
                <Tip id="document.save-status" />
              </div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={pageMode ? IconRegistry.editor.continuous : IconRegistry.editor.pages}
                data-walk="document.page-layout"
                onClick={switchView}
              >
                {pageMode ? 'Continuous view' : 'Page layout'}
              </Button>
              {!readOnly && (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={IconRegistry.editor.save}
                  disabled={status === 'saving' || status === 'conflict'}
                  loading={status === 'saving'}
                  onClick={() => void saver.save()}
                >
                  Save
                </Button>
              )}
            </div>
            <DocumentToolbar
              editor={editor}
              onFind={() => setFindOpen(true)}
              readOnly={readOnly}
              comments={
                canComment || comments.counts.all
                  ? {
                      onComment: canComment ? startComment : undefined,
                      onList: () => {
                        // Closed where there is no margin, a new thread goes too.
                        if (comments.panel && !room && comments.active === DRAFT)
                          comments.cancelDraft()
                        comments.setPanel(comments.panel ? null : 'list')
                        setAskOpen(false)
                      },
                      listOpen: comments.panel !== null,
                      open: comments.counts.open,
                    }
                  : undefined
              }
              ask={
                ask
                  ? {
                      onAsk: askAboutSelection,
                      onRewrite: drafting ? rewriteSelection : undefined,
                      onPanel: () => (askOpen ? setAskOpen(false) : openAsk()),
                      panelOpen: askOpen,
                      labelOf,
                      blocked: ask.archived ? READ_ONLY : undefined,
                    }
                  : undefined
              }
            />
            {comments.hint && (
              <p className="dm-comment-hint" role="status">
                {comments.hint}
              </p>
            )}
            {askHint && (
              <p className="dm-comment-hint" role="status">
                {askHint}
              </p>
            )}
            {findOpen && (
              <FindBar editor={editor} canReplace={!readOnly} onClose={() => setFindOpen(false)} />
            )}
          </div>
          {problem && (
            <div role="alert" className="dm-problem">
              {status === 'conflict' ? (
                <Callout
                  tone="warning"
                  title="Your latest changes were not saved"
                  actions={
                    <Button variant="secondary" size="sm" onClick={onReload}>
                      Reload the document
                    </Button>
                  }
                >
                  {problem} Reloading shows the saved text: copy anything you need from here first.
                </Callout>
              ) : (
                <Callout tone="warning" title="Your latest changes were not saved">
                  {problem} They are saved when you next pause typing, or select Save.
                </Callout>
              )}
            </div>
          )}
          <div className="dm-viewport">
            <div className="om-scroll dm-scroll">
              <div className={marginShown ? 'dm-canvas has-margin' : 'dm-canvas'}>
                {/* The editor keeps its place in the tree in either view, so
                    switching never remounts it (RV-12). */}
                <div className={pageMode ? 'dm-sheet is-page' : 'dm-sheet'}>
                  {pageMode && (
                    <FrontPages
                      key="front"
                      details={details}
                      contents={contents}
                      onOpen={openEntry}
                    />
                  )}
                  <div
                    key="body"
                    className="dm-body"
                    style={
                      pageMode && layout
                        ? { minHeight: pagesHeight(MARSH_GEOMETRY, layout.pages) }
                        : undefined
                    }
                  >
                    {pageMode && layout && (
                      <PageBands key="bands" layout={layout} details={details} />
                    )}
                    <EditorContent key="editor" editor={editor} className="dm-paper" />
                  </div>
                </div>
                {/* Open threads beside their text (RV-03 AC1). */}
                {marginShown && (
                  // Its comment boxes can be dictated into (CP-27).
                  <DictationScope reference={reference}>
                    <CommentMargin
                      editor={editor}
                      comments={comments}
                      me={me}
                      canComment={canComment}
                      actions={actions}
                    />
                  </DictationScope>
                )}
              </div>
            </div>
            {/* Questions about the assessment and the passages asked about (AS-02). */}
            {askOpen && ask && !comments.panel && (
              <DocumentAsk
                editor={editor}
                ask={ask}
                overlay={!room}
                onShowPassage={showAsked}
                drafting={drafting}
                guidance={guidance}
                onClose={() => {
                  setAskOpen(false)
                  setAskMarks(editor.view, { shown: null })
                }}
              />
            )}
            {/* The comments list (AC8), and threads where there is no margin. */}
            {comments.panel && (
              <DictationScope reference={reference}>
                <CommentsPanel
                  comments={comments}
                  parts={report.parts}
                  me={me}
                  canComment={canComment}
                  actions={actions}
                  marginShown={room}
                  overlay={!room}
                  onClose={() => {
                    if (comments.active === DRAFT) comments.cancelDraft()
                    comments.setPanel(null)
                  }}
                />
              </DictationScope>
            )}
          </div>
        </section>
      </div>
      <Dialog
        open={!!leaving}
        title="Leave with unsaved changes?"
        description={
          status === 'failed' || status === 'conflict'
            ? `Your latest changes could not be saved: ${problem ?? ''} Leaving discards them.`
            : 'Your latest changes are not saved yet. Save them first, or leave without them.'
        }
        onClose={() => setLeaving(null)}
        width={520}
        footer={
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}
          >
            <Button variant="secondary" disabled={leaveBusy} onClick={() => setLeaving(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              disabled={leaveBusy}
              onClick={() => {
                const go = leaving!.proceed
                saver.stop()
                setLeaving(null)
                go()
              }}
            >
              Discard and leave
            </Button>
            {status !== 'conflict' && (
              <Button
                variant="primary"
                loading={leaveBusy}
                onClick={async () => {
                  setLeaveBusy(true)
                  const ok = await saver.save()
                  setLeaveBusy(false)
                  if (!ok) return
                  const go = leaving!.proceed
                  setLeaving(null)
                  go()
                }}
              >
                Save and leave
              </Button>
            )}
          </div>
        }
      />
    </DocumentPartsContext.Provider>
  )
}

// The document edit view of the review workspace (RV-08): the whole report
// as one continuous document (AC1), each section under its fixed heading in
// report order, with an outline beside it (AC5). The engineer writes any
// section, drafted or not (AC3, AC4), with formatting (AC6), undo and redo
// (AC7) and find and replace (AC8); citation markers stay with their sources
// (AC9, AC10) and flags stay until resolved in review (AC11). Changes save
// when typing pauses or on Save (AC13), with a warning before unsaved ones
// are lost (AC14). Return to review opens the section being edited (AC2).
// Anyone who can open the report comments on it here (RV-03): threads sit in
// the margin beside their text, and the comments list holds them all; a
// knowledge admin opens it read only, to comment and reply (AC7).
export function DocumentEdit({
  reference,
  assessment = null,
  workspace,
  summary,
  summaryLoaded,
  ofis,
  observations = NO_OBSERVATIONS,
  startAt,
  readOnly = false,
  canComment = false,
  me = NOBODY,
  ask = null,
  onViewObservation,
  onReturn,
  onReload,
  wrapStyle,
  railStyle,
}: {
  reference: string
  // The assessment with its client and site, for the page layout's cover (RV-12).
  assessment?: Assessment | null
  workspace: ReviewWorkspace
  summary: Summary | null
  // Sections 1 and 2 have loaded, or failed to: the document waits for them.
  summaryLoaded: boolean
  // Section 3's OFIs in the report.
  ofis: AcceptedOfi[]
  // The assessment's observations, for the photos of its OFI records.
  observations?: SavedObservation[]
  // The section to open on.
  startAt: string
  // Opened by someone who can't change the text, e.g. a knowledge admin,
  // who still comments (RV-03 AC7).
  readOnly?: boolean
  // May comment on the report, reply, resolve and reopen threads (RV-03).
  canComment?: boolean
  // Who is signed in, for whose comments they may edit and delete (AC3).
  me?: Stamp
  // The Ask tab's conversation, to ask about selected text here (AS-02);
  // null without `reports:ask`.
  ask?: AskWorkflow | null
  // Opens an observation on the Observations tab, or the tab for null (AS-08).
  onViewObservation?: (id: string | null) => void
  onReturn: (sectionId: string) => void
  // Reads the workspace again and reopens the document from it.
  onReload: () => void
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
}) {
  // Why an undrafted section was not drafted (AC3) comes from Generation's
  // list; the document opens without it if it cannot be read.
  const { sections: listed, loadError } = useSections(reference)
  const ready = (listed !== null || loadError !== null) && summaryLoaded
  // Built once, when ready: the document is then the engineer's to change.
  const [report, setReport] = useState<ReportDocument | null>(null)
  if (ready && !report)
    setReport(buildReportDocument({ workspace, summary, listedSections: listed }))
  const parts = useMemo(
    () => ({
      reference,
      purposeAndScope: summary?.purposeAndScope ?? null,
      ofis,
      observations,
      onOpen: onReturn,
    }),
    [reference, summary, ofis, observations, onReturn],
  )
  if (!report) return <p style={{ padding: '24px 28px', margin: 0 }}>Opening the document…</p>
  return (
    <DocumentBody
      reference={reference}
      report={report}
      parts={parts}
      assessment={assessment}
      startAt={startAt}
      readOnly={readOnly}
      canComment={canComment}
      me={me}
      ask={ask}
      onViewObservation={onViewObservation}
      onReturn={onReturn}
      onReload={onReload}
      wrapStyle={wrapStyle}
      railStyle={railStyle}
    />
  )
}
