import { useEffect, useMemo, useRef, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Button, Callout, Dialog, IconRegistry } from '../../../design-system'
import type { AcceptedOfi, ReviewWorkspace, Summary } from '../api'
import { toEditorJSON } from '../document/convert'
import { toggleSubheading } from '../document/commands'
import { DocumentToolbar } from '../document/DocumentToolbar'
import { FindBar } from '../document/FindBar'
import { FindReplace } from '../document/findReplace'
import { DocumentPartsContext } from '../document/parts'
import { ReviewPlugins } from '../document/plugins'
import { documentExtensions } from '../document/schema'
import { buildReportDocument, type ReportDocument } from '../document/sections'
import { useDocumentSave, type SaveStatus } from '../document/useDocumentSave'
import { formatDayTime } from '../format'
import { setLeaveGuard } from '../leaveGuard'
import { useSections } from '../useSections'
import '../document/document.css'

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
  startAt,
  onReturn,
  onReload,
  wrapStyle,
  railStyle,
}: {
  reference: string
  report: ReportDocument
  parts: React.ContextType<typeof DocumentPartsContext>
  startAt: string
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

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: [
      ...documentExtensions,
      ReviewPlugins.configure({ context: report.context }),
      FindReplace,
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
    onUpdate: () => saver.changedNow(),
    onSelectionUpdate: ({ editor: e }) => {
      const id = sectionAtSelection(e)
      if (id) setCurrent(id)
    },
  })

  // Saving starts from the document as it opened.
  useEffect(() => {
    if (editor) saver.attach(editor)
  }, [editor, saver])

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

  const goTo = (id: string) => {
    setCurrent(id)
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
    () =>
      parts && {
        ...parts,
        onOpen: (id: string) => {
          if (saver.dirty()) setLeaving({ proceed: () => onReturn(id) })
          else onReturn(id)
        },
      },
    [parts, saver, onReturn],
  )

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
            Headings and parts filled in elsewhere stay as they are. Violet text is still as the
            draft wrote it; once you change it, it is yours. Changes save when you pause.
          </p>
        </nav>
        <section aria-label="Document editor" className="dm-main">
          <div className="dm-head" ref={header}>
            <div className="dm-bar">
              <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={returnToReview}>
                Return to review
              </Button>
              <p className="dm-save-status" role="status">
                {STATUS_TEXT[status]}
                {savedAt && status !== 'saving' && (
                  <span className="dm-save-time">
                    {' '}
                    · Last saved {formatDayTime(new Date(savedAt))}
                  </span>
                )}
              </p>
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
            </div>
            <DocumentToolbar editor={editor} onFind={() => setFindOpen(true)} />
            {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
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
          <div className="om-scroll dm-scroll">
            <EditorContent editor={editor} className="dm-paper" />
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
export function DocumentEdit({
  reference,
  workspace,
  summary,
  summaryLoaded,
  ofis,
  startAt,
  onReturn,
  onReload,
  wrapStyle,
  railStyle,
}: {
  reference: string
  workspace: ReviewWorkspace
  summary: Summary | null
  // Sections 1 and 2 have loaded, or failed to: the document waits for them.
  summaryLoaded: boolean
  // Section 3's OFIs in the report.
  ofis: AcceptedOfi[]
  // The section to open on.
  startAt: string
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
      onOpen: onReturn,
    }),
    [reference, summary, ofis, onReturn],
  )
  if (!report) return <p style={{ padding: '24px 28px', margin: 0 }}>Opening the document…</p>
  return (
    <DocumentBody
      reference={reference}
      report={report}
      parts={parts}
      startAt={startAt}
      onReturn={onReturn}
      onReload={onReload}
      wrapStyle={wrapStyle}
      railStyle={railStyle}
    />
  )
}
