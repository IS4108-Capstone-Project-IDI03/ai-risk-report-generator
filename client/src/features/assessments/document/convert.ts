// Between the report's saved section documents (api.ts SectionDocument) and
// the document editor's TipTap content (RV-08). The editor holds every
// section in report order, with its fixed headings, notices and locked parts;
// only the text between them is saved, empty paragraphs left out.
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type {
  DocumentBlock,
  DocumentInline,
  DocumentMark,
  DocumentParagraph,
  SectionDocument,
} from '../api'
import { plainText } from '../documentContent'

const MARKS: DocumentMark[] = ['bold', 'italic', 'underline']

// A paragraph or heading's inline content as saved.
export function inlineOf(node: PMNode): DocumentInline[] {
  const content: DocumentInline[] = []
  node.forEach((child) => {
    if (child.type.name === 'citation') content.push({ type: 'cite', id: child.attrs.id as string })
    else if (child.isText && child.text) {
      const marks = MARKS.filter((m) => child.marks.some((mark) => mark.type.name === m))
      content.push({ type: 'text', text: child.text, ...(marks.length && { marks }) })
    }
  })
  return content
}

// One section of the editor: its id, its fixed heading, why it was not
// drafted or what happened to its text, its locked parts and its text.
export type EditorSection = {
  id: string
  label: string
  notices: { tone: 'info' | 'warning'; title: string; text: string }[]
  // Locked parts before the text, by kind (LockedBlockView).
  locked: string[]
  content: SectionDocument
  // Each subsection's kind, in order; a table takes no text.
  kinds: string[]
}

const inlineJSON = (content: DocumentInline[]): JSONContent[] =>
  content.map((c) =>
    c.type === 'cite'
      ? { type: 'citation', attrs: { id: c.id } }
      : {
          type: 'text',
          text: c.text,
          ...(c.marks?.length && { marks: c.marks.map((type) => ({ type })) }),
        },
  )

// A finding's key as the editor holds it: with its section, so a copy pasted
// into another section is told apart (plugins.ts).
const findingAttr = (sectionId: string, finding: string | null | undefined) =>
  finding ? `${sectionId}:${finding}` : null

const paragraphJSON = (sectionId: string, p: DocumentParagraph): JSONContent => ({
  type: 'paragraph',
  attrs: { finding: findingAttr(sectionId, p.finding) },
  ...(p.content.length && { content: inlineJSON(p.content) }),
})

const blockJSON = (sectionId: string, b: DocumentBlock): JSONContent =>
  b.type === 'paragraph'
    ? paragraphJSON(sectionId, b)
    : b.type === 'heading'
      ? {
          type: 'heading',
          attrs: { level: 4, finding: findingAttr(sectionId, b.finding) },
          content: inlineJSON(b.content),
        }
      : {
          type: b.type,
          content: b.items.map((item) => ({
            type: 'listItem',
            content: [paragraphJSON(sectionId, item)],
          })),
        }

const EMPTY_PARAGRAPH: JSONContent = { type: 'paragraph' }

// The editor's content: every section in order.
export function toEditorJSON(sections: EditorSection[]): JSONContent {
  return {
    type: 'doc',
    content: sections.map(({ id, label, notices, locked, content, kinds }) => {
      const intro = content.intro.map((b) => blockJSON(id, b))
      return {
        type: 'reportSection',
        attrs: { id },
        content: [
          { type: 'sectionHeading', attrs: { label } },
          ...notices.map((n) => ({ type: 'sectionNotice', attrs: n })),
          ...locked.map((kind) => ({ type: 'lockedBlock', attrs: { kind, section: id } })),
          // A section with no subsections always has a paragraph to write in.
          ...(content.subsections.length || intro.length ? intro : [EMPTY_PARAGRAPH]),
          ...content.subsections.map((sub, i) => {
            const blocks = sub.blocks.map((b) => blockJSON(id, b))
            return {
              type: 'subsection',
              attrs: { heading: sub.heading, kind: kinds[i] ?? 'narrative' },
              content: [
                { type: 'subsectionHeading', attrs: { label: sub.heading } },
                ...(kinds[i] === 'table'
                  ? [{ type: 'lockedBlock', attrs: { kind: 'table', section: id } }]
                  : blocks.length
                    ? blocks
                    : [EMPTY_PARAGRAPH]),
              ],
            }
          }),
        ],
      }
    }),
  }
}

// The finding a block came from, without its section; undefined for none.
const findingOf = (node: PMNode) => {
  const finding = node.attrs.finding as string | null
  return finding ? finding.slice(finding.indexOf(':') + 1) : undefined
}

// A paragraph as saved; null when it holds nothing.
function paragraphOf(node: PMNode): DocumentParagraph | null {
  const content = inlineOf(node)
  if (!plainText(content) && !content.some((c) => c.type === 'cite')) return null
  const finding = findingOf(node)
  return { type: 'paragraph', ...(finding && { finding }), content }
}

// The text blocks of a section or subsection as saved, empty ones left out.
function blocksOf(parent: PMNode): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  parent.forEach((node) => {
    const name = node.type.name
    if (name === 'paragraph') {
      const p = paragraphOf(node)
      if (p) blocks.push(p)
    } else if (name === 'heading') {
      const content = inlineOf(node)
      const finding = findingOf(node)
      if (plainText(content)) blocks.push({ type: 'heading', ...(finding && { finding }), content })
    } else if (name === 'bulletList' || name === 'orderedList') {
      const items: DocumentParagraph[] = []
      node.forEach((item) => {
        const p = item.firstChild && paragraphOf(item.firstChild)
        if (p) items.push(p)
      })
      if (items.length) blocks.push({ type: name, items })
    }
  })
  return blocks
}

// Each section's text as saved, by section id.
export function fromEditorDoc(doc: PMNode): Map<string, SectionDocument> {
  const sections = new Map<string, SectionDocument>()
  doc.forEach((section) => {
    const subsections: SectionDocument['subsections'] = []
    section.forEach((child) => {
      if (child.type.name === 'subsection')
        subsections.push({ heading: child.attrs.heading as string, blocks: blocksOf(child) })
    })
    sections.set(section.attrs.id as string, { intro: blocksOf(section), subsections })
  })
  return sections
}
