// The export's pages (EX-01): the report laid out in Marsh's page layout
// (RV-12) by the same editor, pagination and pages as the document editor's
// Page layout, so the PDF matches it page for page (AC3). Read-only, and
// without the review screen's marks (AC10): no violet AI styling, review
// states, flags or notices, citation markers numbered as plain superscripts.
// Drawn off screen; once every part has loaded and the pages have settled,
// they are taken as one HTML document (snapshot.ts) and handed to onReady.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import type {
  AcceptedOfi,
  Assessment,
  ReportSection,
  ReviewWorkspace,
  SavedObservation,
  Summary,
} from '../../api'
import { contentsEntries, coverDetails } from '../page/frontMatter'
import { MARSH_GEOMETRY, pagesHeight } from '../page/geometry'
import { FrontPages, PageBands } from '../page/PageFrame'
import { PageLayout, setPageLayout, type PageLayoutState } from '../page/PageLayout'
import { DocumentPartsContext } from '../parts'
import { citationNumbers } from '../plugins'
import { documentExtensions } from '../schema'
import { buildReportDocument } from '../sections'
import { exportContent, type ExportOptions } from './exportDocument'
import { photosIn, SnapshotError, snapshotPages } from './snapshot'
import '../document.css'
import '../page/pages.css'

// Each citation marker's number, as the review decorations draw it, and
// nothing else of theirs.
function numberDecorations(doc: PMNode): DecorationSet {
  const found: Decoration[] = []
  doc.forEach((section, offset) => {
    const numbers = citationNumbers(section)
    section.descendants((node, pos) => {
      if (node.type.name !== 'citation') return true
      const at = offset + 1 + pos
      const n = String(numbers.get(node.attrs.id as string) ?? '')
      found.push(Decoration.node(at, at + node.nodeSize, { 'data-n': n }))
      return false
    })
  })
  return DecorationSet.create(doc, found)
}
const CitationNumbers = Extension.create({
  name: 'citationNumbers',
  addProseMirrorPlugins: () => [
    new Plugin({ props: { decorations: (state) => numberDecorations(state.doc) } }),
  ],
})

// How often the pages are checked, how many checks in a row must find them
// unchanged, and how long to wait at most.
const CHECK_MS = 300
const STEADY_CHECKS = 4
const MAX_WAIT_MS = 60_000

// What the screen shows while a part of the report is still loading.
const LOADING = /Loading…|Laying out the pages…/
// What a part shows when it could not be loaded.
const NOT_LOADED = /not loaded|could not be loaded/i

const NO_OBSERVATIONS: SavedObservation[] = []

export function ExportPages({
  reference,
  assessment,
  workspace,
  summary,
  listedSections,
  ofis,
  observations = NO_OBSERVATIONS,
  options,
  onReady,
  onFail,
}: {
  reference: string
  assessment: Assessment | null
  workspace: ReviewWorkspace
  summary: Summary | null
  listedSections: ReportSection[] | null
  ofis: AcceptedOfi[]
  observations?: SavedObservation[]
  options: ExportOptions & { appendixPhotos: number }
  onReady: (html: string) => void
  onFail: (message: string) => void
}) {
  // Built once: the export lays out the report as it is now.
  const [exported] = useState(() => {
    const report = buildReportDocument({ workspace, summary, listedSections })
    return exportContent(report, workspace, options)
  })
  const [layout, setLayout] = useState<PageLayoutState | null>(null)
  // The newest layout, for the checks below to read.
  const layoutNow = useRef<PageLayoutState | null>(null)
  useEffect(() => {
    layoutNow.current = layout
  }, [layout])
  const sheet = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  const editor = useEditor({
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // Styled as the document editor's text is, so it lays out the same (RV-12).
    editorProps: { attributes: { class: 'dm-prose' } },
    extensions: [
      ...documentExtensions,
      CitationNumbers,
      PageLayout.configure({ geometry: MARSH_GEOMETRY, onLayout: setLayout }),
    ],
    content: exported.content,
  })

  useEffect(() => {
    if (editor) setPageLayout(editor, true)
  }, [editor])

  // Waits for the pages to settle: every part loaded, every photo and font
  // in, and nothing changing over a few checks; then takes them.
  useEffect(() => {
    if (!editor) return
    const started = Date.now()
    let last = ''
    let steady = 0
    const finish = (run: () => void) => {
      if (done.current) return
      done.current = true
      window.clearInterval(timer)
      run()
    }
    const timer = window.setInterval(() => {
      const root = sheet.current
      const now = layoutNow.current
      if (!root) return
      if (Date.now() - started > MAX_WAIT_MS)
        return finish(() =>
          onFail('The report took too long to lay out in pages. Try exporting again.'),
        )
      const text = root.textContent ?? ''
      const failed = Array.from(root.querySelectorAll('.dm-locked')).find((part) =>
        NOT_LOADED.test(part.textContent ?? ''),
      )
      if (failed)
        return finish(() =>
          onFail(
            'Part of the report could not be loaded, so nothing was exported. Check your connection and try again.',
          ),
        )
      const images = photosIn(root)
      // Off screen, a photo set to load when scrolled to never would.
      for (const img of images) if (img.loading === 'lazy') img.loading = 'eager'
      if (images.some((img) => img.complete && !img.naturalWidth))
        return finish(() =>
          onFail('A photo in the report could not be loaded, so nothing was exported. Try again.'),
        )
      const ready =
        !!now?.measured &&
        document.fonts?.status !== 'loading' &&
        images.every((img) => img.complete) &&
        !LOADING.test(text) &&
        Array.from(root.querySelectorAll('.dm-locked:not([hidden]) .dm-locked-body')).every(
          (body) => body.childElementCount > 0,
        )
      const signature = `${root.innerHTML.length}|${JSON.stringify(now)}`
      steady = ready && signature === last ? steady + 1 : 0
      last = signature
      if (steady < STEADY_CHECKS) return
      finish(() => {
        try {
          onReady(
            snapshotPages({
              sheet: root,
              view: editor.view,
              parts: exported.parts,
              title: `${reference} Property Risk Evaluation Report`,
            }),
          )
        } catch (error: unknown) {
          onFail(
            error instanceof SnapshotError
              ? error.message
              : 'The report could not be prepared for export. Try again.',
          )
        }
      })
    }, CHECK_MS)
    return () => window.clearInterval(timer)
  }, [editor, exported, reference, onReady, onFail])

  const parts = useMemo(
    () => ({
      reference,
      purposeAndScope: summary?.purposeAndScope ?? null,
      ofis,
      observations,
      pageLayout: true,
      onOpen: () => {},
      references: exported.references,
    }),
    [reference, summary, ofis, observations, exported],
  )
  const details = coverDetails(assessment)
  const contents = layout ? contentsEntries(exported.parts, layout.headings) : null

  if (!editor) return null
  return (
    <DocumentPartsContext.Provider value={parts}>
      {/* Off screen, at its printed size: it is laid out, never seen. */}
      <div className="dm-export-stage" aria-hidden="true" inert>
        <div ref={sheet} className="dm-sheet is-page is-export">
          <FrontPages details={details} contents={contents} onOpen={() => {}} />
          <div
            className="dm-body"
            style={layout ? { minHeight: pagesHeight(MARSH_GEOMETRY, layout.pages) } : undefined}
          >
            {layout && <PageBands layout={layout} details={details} />}
            <EditorContent editor={editor} className="dm-paper" />
          </div>
        </div>
      </div>
    </DocumentPartsContext.Provider>
  )
}
