// Reading a section's document (RV-08): its text blocks, their words and
// citations, and whether the engineer wrote any text of their own; and, for
// the version history (RV-06), a draft's text as a document and an earlier
// version's text carried onto the saved draft. Pure functions, shared by
// report-document.service (saving), review-decision.service (logging what
// changed), review.service (the section's states) and
// version-history.service (listing and restoring versions).
import type {
  DocumentBlock,
  DocumentInline,
  DocumentParagraph,
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

// A draft's text as it read when it became the section's saved content, for
// the version history (RV-06): each statement a paragraph of its words, then
// its citation markers, as the document editor first shows it, in the
// draft's subsections. `findings` give the words: a finding kept from an
// earlier draft carries the engineer's edit with it. A table takes no text.
export function draftDocument(
  draft: { subsections: { heading: string; kind: string; statements: unknown[] }[] },
  findings: readonly { key: string; text: string; citations: string[] }[],
): SectionDocument {
  const byKey = new Map(findings.map((f) => [f.key, f]))
  return {
    intro: [],
    subsections: draft.subsections.map((sub, i) => ({
      heading: sub.heading,
      blocks:
        sub.kind === 'table'
          ? []
          : sub.statements.flatMap((_, j): DocumentBlock[] => {
              const key = `${i}.${j}`
              const finding = byKey.get(key)
              const content = finding ? asDrafted(finding) : []
              return content.length ? [{ type: 'paragraph', finding: key, content }] : []
            }),
    })),
  }
}

// A section's text, written on one draft (or on none), as it reads on the
// section's saved draft now, to restore it (RV-06). Written on the saved
// draft, it is as it was. Otherwise its finding keys name another draft's
// statements, so each passage that was a finding becomes the saved draft's
// finding with the same words in the same subsection, if one is left (the
// findings kept word for word into a redraft are found this way), and any
// other is the engineer's own text. Text in a subsection the saved draft
// lacks, or has as a table, moves before the first subsection, so none is
// lost.
export function ontoDraft(
  document: SectionDocument,
  sameDraft: boolean,
  draft: { subsections: { heading: string; kind: string }[] } | null,
  findings: readonly { key: string; text: string; generatedText: string }[],
): SectionDocument {
  if (sameDraft) return document
  const subsections = draft?.subsections ?? []
  const intro: DocumentBlock[] = []
  const placed: DocumentBlock[][] = subsections.map(() => [])
  const used = new Set<string>()
  // The saved draft's finding in subsection `i` with these words, not yet placed.
  const match = (i: number, content: DocumentInline[]): string | null => {
    const words = plainText(content)
    const found = findings.find(
      (f) =>
        !used.has(f.key) &&
        Number(f.key.split('.')[0]) === i &&
        (tidy(f.text) === words || tidy(f.generatedText) === words),
    )
    if (!found) return null
    used.add(found.key)
    return found.key
  }
  const carried = (i: number, finding: string | null | undefined, content: DocumentInline[]) =>
    finding && i >= 0 ? match(i, content) : null
  const paragraph = (p: DocumentParagraph, i: number): DocumentParagraph => {
    const key = carried(i, p.finding, p.content)
    return key
      ? { type: 'paragraph', finding: key, content: p.content }
      : { type: 'paragraph', content: p.content }
  }
  const block = (b: DocumentBlock, i: number): DocumentBlock => {
    if (b.type === 'paragraph') return paragraph(b, i)
    if (b.type === 'heading') {
      const key = carried(i, b.finding, b.content)
      return key
        ? { type: 'heading', finding: key, content: b.content }
        : { type: 'heading', content: b.content }
    }
    return { type: b.type, items: b.items.map((item) => paragraph(item, i)) }
  }
  for (const b of document.intro) intro.push(block(b, -1))
  for (const sub of document.subsections) {
    const i = subsections.findIndex((s) => s.heading === sub.heading && s.kind !== 'table')
    for (const b of sub.blocks) (i < 0 ? intro : placed[i]).push(block(b, i))
  }
  return {
    intro,
    subsections: subsections.map((s, i) => ({ heading: s.heading, blocks: placed[i] })),
  }
}
