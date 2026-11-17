// A passage selected in the draft to ask about (AS-02): where it is, kept as
// a comment thread's anchor is (RV-03, comments/anchor.ts), the sources it
// cites and the keys of the findings it is in. Two places offer "Ask about
// this": the review workspace's draft editor (sections 4-12, drawn by
// DraftEditor) and the document editor. Both read a section's text as the
// document editor saves it (blocks joined by a line break, a citation marker
// as U+FFFC), so a passage asked about in one is found again in the other.
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocumentHeading, DocumentInline, DocumentParagraph, SectionDocument } from '../api'
import { anchorIn, locate, MARKER, selectedText, type SectionText } from '../comments/anchor'
import type { CommentAnchor } from '../comments/api'
import { textBlocksIn, tidy } from '../documentContent'

// The longest passage a question can be about, as the gateway allows.
export const MAX_PASSAGE = 4000

export type AskPassage = {
  anchor: CommentAnchor
  // The section as the report heads it, e.g. "9. Fire Protection".
  label: string
  // The sources cited in the blocks the passage is in (O:/C:/P: refs).
  citations: string[]
  // The keys of the findings it is in, e.g. "0.2".
  findings: string[]
}

// One text block of a section's text, from its saved content or the editor.
export type PassageBlock = {
  offset: number
  length: number
  finding: string | null
  cites: string[]
}
export type PassageText = {
  sectionId: string
  text: string
  blocks: PassageBlock[]
  // Each saved block of the content, by itself, for drawing (DraftEditor).
  indexOf: Map<DocumentParagraph | DocumentHeading, number>
}

const words = (content: DocumentInline[]) =>
  content.map((c) => (c.type === 'text' ? c.text : MARKER)).join('')
const citesIn = (content: DocumentInline[]) => [
  ...new Set(content.flatMap((c) => (c.type === 'cite' ? [c.id] : []))),
]

// A section's text from its saved content (documentContent.ts), as the
// document editor reads it once opened: its intro's blocks, then each
// subsection's, a block left out when it holds no words (a paragraph with only
// a citation marker is kept, as the editor saves it).
export function contentText(sectionId: string, content: SectionDocument): PassageText {
  const blocks: PassageBlock[] = []
  const indexOf = new Map<DocumentParagraph | DocumentHeading, number>()
  let text = ''
  const all = [...content.intro, ...content.subsections.flatMap((s) => s.blocks)]
  for (const block of textBlocksIn(all)) {
    const saidWords = tidy(block.content.map((c) => (c.type === 'text' ? c.text : '')).join(''))
    const cites = citesIn(block.content)
    const saved = saidWords !== '' || (block.type === 'paragraph' && cites.length > 0)
    if (!saved) continue
    if (blocks.length) text += '\n'
    const own = words(block.content)
    indexOf.set(block, blocks.length)
    blocks.push({ offset: text.length, length: own.length, finding: block.finding ?? null, cites })
    text += own
  }
  return { sectionId, text, blocks, indexOf }
}

// The section's text as the document editor holds it now, from comments/anchor.ts.
function editorBlocks(selected: SectionText): PassageText {
  const prefix = `${selected.sectionId}:`
  const blocks = selected.runs.map(({ offset, length, node }) => {
    const cites: string[] = []
    node?.forEach((child) => {
      if (child.type.name === 'citation') cites.push(child.attrs.id as string)
    })
    const finding = (node?.attrs.finding as string | null | undefined) ?? null
    return {
      offset,
      length,
      // The editor names a finding with its section (convert.ts findingAttr).
      finding: finding?.startsWith(prefix) ? finding.slice(prefix.length) : finding,
      cites: [...new Set(cites)],
    }
  })
  return { sectionId: selected.sectionId, text: selected.text, blocks, indexOf: new Map() }
}

const CANT = "Can't ask here"
type Problem = 'nothing' | 'sections' | 'words' | 'length'
const REASONS: Record<Problem, string> = {
  nothing: 'Select the text to ask about.',
  sections: 'Select text within one section to ask about it.',
  words:
    'Select some of the text to ask about. Headings and parts filled in elsewhere hold none to ask about.',
  length: `Select up to ${MAX_PASSAGE.toLocaleString('en-GB')} characters to ask about.`,
}
export type Reason = { title: string; text: string }
export type AskTarget = { passage: AskPassage } | { reason: Reason }
const refused = (problem: Problem): AskTarget => ({
  reason: { title: CANT, text: REASONS[problem] },
})

// The passage between two offsets of a section's text, or why it cannot be
// asked about: no words in it, or too long. Its citations are those of every
// block it is in, so a few words of a finding bring the finding's sources.
export function passageIn(text: PassageText, start: number, end: number, label: string): AskTarget {
  const exact = end > start ? text.text.slice(start, end) : ''
  if (!tidy(exact.replaceAll(MARKER, ' '))) return refused(end > start ? 'words' : 'nothing')
  if (exact.length > MAX_PASSAGE) return refused('length')
  const touched = text.blocks.filter((b) => start < b.offset + b.length && end > b.offset)
  return {
    passage: {
      anchor: anchorIn({ sectionId: text.sectionId, text: text.text, runs: [] }, start, end),
      label,
      citations: [...new Set(touched.flatMap((b) => b.cites))],
      findings: [...new Set(touched.flatMap((b) => (b.finding ? [b.finding] : [])))],
    },
  }
}

// The passage selected between two document editor positions, or why there
// is none. `labelOf` heads a section as the report does.
export function editorPassage(
  doc: PMNode,
  from: number,
  to: number,
  labelOf: (sectionId: string) => string,
): AskTarget {
  const selected = selectedText(doc, from, to, MAX_PASSAGE)
  if (!('text' in selected)) return refused(selected.problem)
  const text = editorBlocks(selected.text)
  return passageIn(text, selected.start, selected.end, labelOf(text.sectionId))
}

// Where a passage asked about is in its section's text now, as [start, end),
// or null once it has been deleted (AC3).
export function passageAt(
  text: PassageText | null,
  anchor: CommentAnchor,
): [number, number] | null {
  if (!text || text.sectionId !== anchor.sectionId) return null
  return locate({ sectionId: text.sectionId, text: text.text, runs: [] }, anchor)
}

// The passage's words as quoted in the Ask tab: verbatim, each block on its own
// line, the citation markers left out (AC2).
export const quotedWords = (exact: string) => exact.replaceAll(MARKER, '')

// What the gateway is sent: the anchor, citations and findings, not the label.
export const passageBody = ({ anchor, citations, findings }: AskPassage) => ({
  anchor,
  citations,
  findings,
})
