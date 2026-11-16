// Reading a section's document (RV-08): its text blocks, their words and
// citations, and whether the engineer wrote any text of their own; and, for
// the version history (RV-06), a draft's text as a document and an earlier
// version's text carried onto the saved draft. For text drafted from the Ask
// tab (AS-04): the section's text now as the editors show it, where a passage
// is in it, inserting and replacing paragraphs, and which inserted sentences
// are still unsupported. Pure functions, shared by report-document.service
// (saving), review-decision.service (logging what changed), review.service
// (the section's states), version-history.service (listing and restoring
// versions) and text-proposal.service (AS-04).
import { createHash } from 'node:crypto'
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
  // The proposal of AI-drafted text awaiting Accept it holds (AS-04), if any.
  ai: string | null
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
        ? [
            {
              content: b.content,
              finding: b.finding ?? null,
              ai: (b.type === 'paragraph' && b.ai) || null,
              shape: b.type,
              subsection,
            },
          ]
        : b.items.map((item) => ({
            content: item.content,
            finding: item.finding ?? null,
            ai: item.ai ?? null,
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

// Whether the document holds any text not taken from the draft: a paragraph,
// list item or sub-heading the engineer wrote, or AI-drafted text inserted from
// the Ask tab (AS-04). Either way the section is written there.
export function hasWrittenText(document: SectionDocument): boolean {
  return textBlocksOf(document).some((b) => !b.finding && plainText(b.content))
}

// Whether the engineer wrote text of their own: as above, leaving out AI-drafted
// text still awaiting their Accept (AS-04), which is not theirs yet.
export function hasOwnText(document: SectionDocument): boolean {
  return textBlocksOf(document).some((b) => !b.finding && !b.ai && plainText(b.content))
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
    // AI-drafted text awaiting Accept stays so (AS-04).
    return key
      ? { type: 'paragraph', finding: key, content: p.content }
      : { type: 'paragraph', ...(p.ai && { ai: p.ai }), content: p.content }
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

// ---- Text drafted from the Ask tab (AS-04) ---------------------------------

// A citation marker in a section's text, as an anchor holds it (RV-03).
export const MARKER = '\uFFFC'

// One finding of the saved draft as the section's text is built from it: its
// text and citations now, and whether it was rejected (RV-02).
type DraftedFinding = { key: string; text: string; citations: string[]; state: string }

// The section's text as the review workspace shows it and the document editor
// opens it: its newest version while it was made on the saved draft (`version`,
// else null), brought up to date with the review decisions made since;
// otherwise the draft itself, finding by finding. The same as the client's
// documentContent.ts contentOf: keep the two in step. A block taken from the
// draft keeps its formatting while its words are still the finding's; one
// reworded in the review workspace since shows its new words; a rejected one is
// left out; one restored, or never in the version, goes at the end of its
// subsection. Tables take no text.
export function currentDocument(
  draft: { subsections: { heading: string; kind: string; statements: unknown[] }[] } | null,
  findings: readonly DraftedFinding[],
  version: SectionDocument | null,
): SectionDocument {
  if (!draft) return version ?? { intro: [], subsections: [] }
  const statements = new Map(findings.map((f) => [f.key, f]))
  const placed = new Set<string>()
  const resolve = <T extends DocumentParagraph | Extract<DocumentBlock, { type: 'heading' }>>(
    b: T,
  ): T | null => {
    if (!b.finding) return b
    const st = statements.get(b.finding)
    if (!st || st.state === 'rejected' || placed.has(b.finding)) return null
    placed.add(b.finding)
    return plainText(b.content) === tidy(st.text) ? b : { ...b, content: asDrafted(st) }
  }
  const resolveAll = (blocks: DocumentBlock[]): DocumentBlock[] =>
    blocks.flatMap((b): DocumentBlock[] => {
      if (b.type === 'paragraph' || b.type === 'heading') {
        const kept = resolve(b)
        return kept ? [kept] : []
      }
      const items = b.items.flatMap((item) => resolve(item) ?? [])
      return items.length ? [{ ...b, items }] : []
    })
  const intro = version ? resolveAll(version.intro) : []
  const subsections = draft.subsections.map((sub, i) => ({
    heading: sub.heading,
    blocks: sub.kind === 'table' ? [] : resolveAll(version?.subsections[i]?.blocks ?? []),
  }))
  draft.subsections.forEach((sub, i) =>
    sub.statements.forEach((_, j) => {
      const key = `${i}.${j}`
      const st = statements.get(key)
      if (sub.kind === 'table' || !st || st.state === 'rejected' || placed.has(key)) return
      placed.add(key)
      subsections[i].blocks.push({ type: 'paragraph', finding: key, content: asDrafted(st) })
    }),
  )
  return { intro, subsections }
}

// The same text, the same way, gives the same signature: what a proposal
// records of the section it was made on, to tell whether it changed since (AC6).
export const documentSignature = (document: SectionDocument) =>
  createHash('sha256').update(JSON.stringify(document)).digest('hex')

// Where each text block of a document is, in textBlocksOf's order: its
// container (-1 the intro, else the subsection), its block there, and its item
// when it is in a list.
type Place = { container: number; block: number; item: number | null }
function placesOf(document: SectionDocument): Place[] {
  const of = (blocks: DocumentBlock[], container: number): Place[] =>
    blocks.flatMap((b, block): Place[] =>
      b.type === 'paragraph' || b.type === 'heading'
        ? [{ container, block, item: null }]
        : b.items.map((_, item) => ({ container, block, item })),
    )
  return [...of(document.intro, -1), ...document.subsections.flatMap((s, i) => of(s.blocks, i))]
}

// A section's text as the document editor saves it, for finding a passage the
// engineer selected (RV-03, AS-02): each text block holding words (or a
// paragraph holding only a citation marker), joined by a line break, a
// citation marker as U+FFFC. The same as the client's ask/passage.ts
// contentText. `index` is the block's place in textBlocksOf.
export type SectionTextBlock = TextBlock & { index: number; offset: number; length: number }
export function sectionText(document: SectionDocument): {
  text: string
  blocks: SectionTextBlock[]
} {
  const blocks: SectionTextBlock[] = []
  let text = ''
  textBlocksOf(document).forEach((block, index) => {
    const words = tidy(block.content.map((c) => (c.type === 'text' ? c.text : '')).join(''))
    const cites = citesOf(block.content)
    if (!words && !(block.shape !== 'heading' && cites.length)) return
    if (blocks.length) text += '\n'
    const own = block.content.map((c) => (c.type === 'text' ? c.text : MARKER)).join('')
    blocks.push({ ...block, index, offset: text.length, length: own.length })
    text += own
  })
  return { text, blocks }
}

// The paragraphs a rewrite replaces (AS-04): every text block from `from` to
// `to` (textBlocksOf indexes), all plain paragraphs of one subsection (or of
// the intro), or all items of one list. Null when they are not: a sub-heading,
// or text across subsections or lists, is not rewritten.
export type RewriteRange = { container: number; list: number | null; start: number; end: number }
export function rewriteRange(
  document: SectionDocument,
  from: number,
  to: number,
): RewriteRange | null {
  const blocks = textBlocksOf(document)
  const places = placesOf(document)
  const picked = places.slice(from, to + 1)
  if (!picked.length || blocks.slice(from, to + 1).some((b) => b.shape === 'heading')) return null
  const [first] = picked
  const last = picked[picked.length - 1]
  if (picked.some((p) => p.container !== first.container)) return null
  if (first.item === null)
    return picked.every((p) => p.item === null)
      ? { container: first.container, list: null, start: first.block, end: last.block }
      : null
  return picked.every((p) => p.item !== null && p.block === first.block)
    ? { container: first.container, list: first.block, start: first.item, end: last.item! }
    : null
}

const blocksIn = (document: SectionDocument, container: number) =>
  container < 0 ? document.intro : document.subsections[container].blocks
const copyOf = (document: SectionDocument): SectionDocument =>
  JSON.parse(JSON.stringify(document)) as SectionDocument

// The document with `paragraphs` at the end of a container (-1 the intro).
export function insertParagraphs(
  document: SectionDocument,
  container: number,
  paragraphs: DocumentParagraph[],
): SectionDocument {
  const next = copyOf(document)
  blocksIn(next, container).push(...paragraphs)
  return next
}

// The document with the range's paragraphs (or list items) replaced by
// `paragraphs` (as items, in a list).
export function replaceParagraphs(
  document: SectionDocument,
  range: RewriteRange,
  paragraphs: DocumentParagraph[],
): SectionDocument {
  const next = copyOf(document)
  const blocks = blocksIn(next, range.container)
  const count = range.end - range.start + 1
  if (range.list === null) blocks.splice(range.start, count, ...paragraphs)
  else {
    const list = blocks[range.list] as Extract<DocumentBlock, { items: unknown }>
    list.items.splice(range.start, count, ...paragraphs)
  }
  return next
}

// Each proposal whose AI-drafted text is in the document awaiting Accept, in
// the order it first appears.
export function aiIdsIn(document: SectionDocument): string[] {
  return [...new Set(textBlocksOf(document).flatMap((b) => (b.ai ? [b.ai] : [])))]
}

// The document with one proposal's AI-drafted text changed: kept as the
// engineer's own (Accept), or taken out (Delete), a list left empty with it.
export function settleAiText(
  document: SectionDocument,
  id: string,
  keep: boolean,
): SectionDocument {
  const settle = (p: DocumentParagraph): DocumentParagraph[] => {
    if (p.ai !== id) return [p]
    if (!keep) return []
    const kept: DocumentParagraph = { ...p }
    delete kept.ai
    return [kept]
  }
  const of = (blocks: DocumentBlock[]): DocumentBlock[] =>
    blocks.flatMap((b): DocumentBlock[] => {
      if (b.type === 'heading') return [b]
      if (b.type === 'paragraph') return settle(b)
      const items = b.items.flatMap(settle)
      return items.length ? [{ ...b, items }] : []
    })
  return {
    intro: of(document.intro),
    subsections: document.subsections.map((s) => ({ heading: s.heading, blocks: of(s.blocks) })),
  }
}

// The sentences of each proposal's inserted text that are still unsupported
// (AS-04 AC3), by proposal: of the sentences it was proposed without a source
// (`unsupported`), each still in a paragraph of its text, word for word, with
// no citation marker straight after it. Giving one a citation, rewording it or
// deleting it resolves it. Keep in step with the client's ask/aiText.ts.
export function unsupportedAiText(
  document: SectionDocument,
  unsupported: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const blocks = textBlocksOf(document).filter((b) => b.ai && unsupported.has(b.ai))
  for (const [id, sentences] of unsupported) {
    const texts = blocks
      .filter((b) => b.ai === id)
      .map((b) =>
        b.content
          .map((c) => (c.type === 'text' ? c.text : MARKER))
          .join('')
          .replace(/\s+/g, ' '),
      )
    const still = sentences.filter((sentence) => {
      const words = tidy(sentence)
      return texts.some((text) => {
        const at = text.indexOf(words)
        const after = at >= 0 ? text.slice(at + words.length).trimStart() : ''
        return at >= 0 && !after.startsWith(MARKER)
      })
    })
    if (still.length) found.set(id, still)
  }
  return found
}
