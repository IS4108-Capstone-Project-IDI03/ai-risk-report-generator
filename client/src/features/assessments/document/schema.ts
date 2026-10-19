// The document editor's schema (RV-08): the whole report as one TipTap
// document. Each report section is a `reportSection` under a fixed heading;
// a drafted section holds its template subsections, each under its own fixed
// heading. What the engineer cannot change here (the headings, why a section
// was not drafted, and parts filled in elsewhere such as tables and photos)
// are atoms the structure guard (plugins.ts) keeps in place. The text
// between them is ordinary paragraphs, sub-headings and flat lists, with
// bold, italic and underline. A citation marker is an inline atom naming its
// source, so it moves with the words around it and is deleted only as a
// whole. A paragraph taken from the draft carries its finding as
// `<section>:<subsection>.<statement>`.
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { LockedBlockView } from './LockedBlockView'

// The top node: the report's sections in order.
const ReportDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'reportSection+',
})

// One section of the report: its heading, any notices and locked parts, then
// its text, before and in its subsections.
const ReportSection = Node.create({
  name: 'reportSection',
  content: 'sectionHeading sectionNotice* lockedBlock* block* subsection*',
  isolating: true,
  defining: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      id: {
        default: '',
        renderHTML: (attrs) => ({
          'data-section': attrs.id,
          id: `dm-section-${attrs.id}`,
        }),
      },
    }
  },
  // Never made from pasted HTML: sections come only from the report.
  parseHTML: () => [],
  renderHTML: ({ HTMLAttributes }) => [
    'section',
    mergeAttributes(HTMLAttributes, { class: 'dm-section' }),
    0,
  ],
})

// A fixed heading: the section's ("7. Construction") or a template
// subsection's. Read-only, and not selectable, so typing never replaces it.
const fixedHeading = (name: string, tag: 'h2' | 'h3') =>
  Node.create({
    name,
    atom: true,
    selectable: false,
    draggable: false,
    addAttributes: () => ({ label: { default: '', rendered: false } }),
    parseHTML: () => [],
    renderHTML: ({ node }) => [
      tag,
      { class: `dm-fixed-heading dm-${tag}`, contenteditable: 'false' },
      node.attrs.label as string,
    ],
  })

// Why a section was not drafted, or what happened to its saved text (AC3).
const SectionNotice = Node.create({
  name: 'sectionNotice',
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: () => ({
    tone: { default: 'info', rendered: false },
    title: { default: '', rendered: false },
    text: { default: '', rendered: false },
  }),
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'div',
    {
      class: `dm-notice is-${node.attrs.tone as string}`,
      contenteditable: 'false',
      role: 'note',
    },
    ['strong', {}, node.attrs.title as string],
    ['span', {}, ` ${node.attrs.text as string}`],
  ],
})

// A part of the report filled in elsewhere, shown in place, read-only: the
// assessment details of Section 1, the OFIs, the figures of Sections 4 and 5,
// a table subsection and the Appendix A photos.
const LockedBlock = Node.create({
  name: 'lockedBlock',
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: () => ({
    kind: { default: '', rendered: false },
    section: { default: '', rendered: false },
  }),
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'div',
    { class: 'dm-locked', 'data-kind': node.attrs.kind as string, contenteditable: 'false' },
  ],
  addNodeView() {
    // ProseMirror leaves the part's own controls and contents alone.
    return ReactNodeViewRenderer(LockedBlockView, {
      stopEvent: () => true,
      ignoreMutation: () => true,
    })
  },
})

// A template subsection: its fixed heading, then its text, or a locked part
// for a table.
const Subsection = Node.create({
  name: 'subsection',
  content: 'subsectionHeading (lockedBlock | block+)',
  isolating: true,
  defining: true,
  selectable: false,
  draggable: false,
  addAttributes: () => ({
    heading: { default: '', rendered: false },
    kind: { default: 'narrative', rendered: false },
  }),
  parseHTML: () => [],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { class: 'dm-subsection' }),
    0,
  ],
})

// A list item holds one paragraph, so lists stay flat, as the report's are.
const ListItem = Node.create({
  name: 'listItem',
  content: 'paragraph',
  defining: true,
  parseHTML: () => [{ tag: 'li' }],
  renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes), 0],
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },
})

// A citation marker (AC9): an inline atom naming its source. Its number and
// accessible name are drawn by the review decorations (plugins.ts), as they
// depend on the markers before it in its section.
const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,
  addAttributes: () => ({
    id: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-cite'),
      renderHTML: (attrs) => ({ 'data-cite': attrs.id }),
    },
  }),
  // Pasted back in from this editor, a marker keeps its source.
  parseHTML: () => [{ tag: 'sup[data-cite]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'sup',
    mergeAttributes(HTMLAttributes, { class: 'dm-cite', contenteditable: 'false' }),
  ],
  renderText: () => '',
})

// Which finding a paragraph or sub-heading came from, as
// `<section>:<subsection>.<statement>`. Not carried to the second half of a
// split block, which is new text.
const FindingAttribute = Extension.create({
  name: 'findingAttribute',
  addGlobalAttributes: () => [
    {
      // A finding set as a sub-heading stays that finding.
      types: ['paragraph', 'heading'],
      attributes: {
        finding: {
          default: null,
          keepOnSplit: false,
          parseHTML: (element) => element.getAttribute('data-finding'),
          renderHTML: (attrs) => (attrs.finding ? { 'data-finding': attrs.finding } : {}),
        },
      },
    },
  ],
})

// Everything the document editor is built from, bar the review plugins.
export const documentExtensions = [
  StarterKit.configure({
    document: false,
    listItem: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    hardBreak: false,
    horizontalRule: false,
    strike: false,
    link: false,
    trailingNode: false,
    // The engineer's sub-headings sit below the template's subsection headings.
    heading: { levels: [4] },
    undoRedo: { depth: 200 },
  }),
  ReportDocument,
  ReportSection,
  fixedHeading('sectionHeading', 'h2'),
  fixedHeading('subsectionHeading', 'h3'),
  SectionNotice,
  LockedBlock,
  Subsection,
  ListItem,
  Citation,
  FindingAttribute,
  Placeholder.configure({
    includeChildren: true,
    // Shown in every empty paragraph, so a section to write says so unfocused.
    showOnlyCurrent: false,
    placeholder: ({ node }) => (node.type.name === 'heading' ? 'Sub-heading' : 'Write here'),
  }),
]
