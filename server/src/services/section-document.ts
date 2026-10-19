// Reading a section's document (RV-08): its text blocks, their words and
// citations, and whether the engineer wrote any text of their own. Pure
// functions, shared by report-document.service (saving), review-decision
// .service (logging what changed) and review.service (the section's states).
import type {
  DocumentBlock,
  DocumentInline,
  SectionDocument,
} from '../models/report-section-version.model'

// How a block of text is set: a paragraph, a sub-heading, or an item of a
// bulleted or numbered list. A finding the engineer turns into a sub-heading
// or a list item is still that finding, set differently.
export type TextShape = 'paragraph' | 'heading' | 'bulletList' | 'orderedList'
export type TextBlock = {
  content: DocumentInline[]
  // The drafted finding it came from, as `<subsection>.<statement>`, if any.
  finding: string | null
  shape: TextShape
  // The subsection it is in, by index; -1 for the intro.
  subsection: number
}

// Every block of text in a document, in order: paragraphs, sub-headings and
// list items. A list's one member covers both kinds of list, so a list is
// told apart from the others by elimination.
export function textBlocksOf(document: SectionDocument): TextBlock[] {
  const of = (blocks: DocumentBlock[], subsection: number): TextBlock[] =>
    blocks.flatMap((b): TextBlock[] =>
      b.type === 'paragraph' || b.type === 'heading'
        ? [{ content: b.content, finding: b.finding ?? null, shape: b.type, subsection }]
        : b.items.map((item) => ({
            content: item.content,
            finding: item.finding ?? null,
            shape: b.type,
            subsection,
          })),
    )
  return [...of(document.intro, -1), ...document.subsections.flatMap((sub, i) => of(sub.blocks, i))]
}

// The document's blocks that came from the draft, by finding key.
export function findingBlocks(document: SectionDocument): Map<string, TextBlock> {
  return new Map(
    textBlocksOf(document).flatMap((b) => (b.finding ? [[b.finding, b] as const] : [])),
  )
}

// Text with its spacing tidied, as the document editor's text is compared.
export const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

// The words of a paragraph or heading, citations left out, spacing tidied:
// what an audit entry records and what is compared with a finding's text.
export function plainText(content: DocumentInline[]): string {
  return tidy(content.map((c) => (c.type === 'text' ? c.text : ' ')).join(''))
}

// The sources a block cites, in order, each once.
export const citesOf = (content: DocumentInline[]) => [
  ...new Set(content.flatMap((c) => (c.type === 'cite' ? [c.id] : []))),
]

// The content with neighbouring runs of the same formatting joined and its
// spacing tidied, so two ways of writing the same text compare equal.
export function signature(content: DocumentInline[]): string {
  const runs: (string | { text: string; marks: string })[] = []
  for (const c of content) {
    if (c.type === 'cite') {
      runs.push(`cite:${c.id}`)
      continue
    }
    const marks = [...(c.marks ?? [])].sort().join(',')
    const last = runs.at(-1)
    if (typeof last === 'object' && last.marks === marks) last.text += c.text
    else runs.push({ text: c.text, marks })
  }
  const tidied = runs.map((r) =>
    typeof r === 'string' ? r : { ...r, text: r.text.replace(/\s+/g, ' ') },
  )
  // Spacing at either end is not part of the text.
  const first = tidied[0]
  if (first && typeof first === 'object') first.text = first.text.trimStart()
  const last = tidied.at(-1)
  if (last && typeof last === 'object') last.text = last.text.trimEnd()
  return JSON.stringify(tidied.filter((r) => typeof r === 'string' || r.text))
}

// A finding as the document editor first shows it: a paragraph of its text,
// then its citation markers. Keep in step with the client's documentContent.ts.
export function asDrafted(finding: { text: string; citations: string[] }): DocumentInline[] {
  return [
    ...(tidy(finding.text) ? [{ type: 'text' as const, text: tidy(finding.text) }] : []),
    ...finding.citations.map((id) => ({ type: 'cite' as const, id })),
  ]
}

export const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

// Whether the engineer wrote any text of their own into the document: a
// paragraph, list item or sub-heading not taken from the draft.
export function hasWrittenText(document: SectionDocument): boolean {
  return textBlocksOf(document).some((b) => !b.finding && plainText(b.content))
}

// The subsections that hold text the engineer wrote, by index.
export function writtenSubsections(document: SectionDocument): Set<number> {
  return new Set(
    textBlocksOf(document).flatMap((b) =>
      b.subsection >= 0 && !b.finding && plainText(b.content) ? [b.subsection] : [],
    ),
  )
}

// How many characters of text the document holds, citations left out.
export function textLength(document: SectionDocument): number {
  return textBlocksOf(document).reduce((n, b) => n + plainText(b.content).length, 0)
}
