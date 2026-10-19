// A report section's text as the review workspace shows it and the document
// editor opens it (RV-08): the section's newest saved version, while it was
// made on the section's saved draft, brought up to date with the review
// decisions made since; otherwise the draft itself, finding by finding.
// Keep the reading of text and citations in step with the gateway's
// services/section-document.ts.
import type {
  DocumentBlock,
  DocumentHeading,
  DocumentInline,
  DocumentParagraph,
  ReviewSection,
  SectionDocument,
  SectionDraft,
  SectionVersion,
} from './api'

export const EMPTY_DOCUMENT: SectionDocument = { intro: [], subsections: [] }

// Spacing tidied the way the gateway compares text.
export const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

// The words of a paragraph or heading, citations left out.
export const plainText = (content: DocumentInline[]) =>
  tidy(content.map((c) => (c.type === 'text' ? c.text : ' ')).join(''))

// The sources a paragraph cites, in order, each once.
export const citesOf = (content: DocumentInline[]) => [
  ...new Set(content.flatMap((c) => (c.type === 'cite' ? [c.id] : []))),
]

// The content with neighbouring runs of the same formatting joined and its
// spacing tidied, so two ways of writing the same text compare equal. The same
// as the gateway's services/section-document.ts signature().
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
  const first = tidied[0]
  if (first && typeof first === 'object') first.text = first.text.trimStart()
  const last = tidied.at(-1)
  if (last && typeof last === 'object') last.text = last.text.trimEnd()
  return JSON.stringify(tidied.filter((r) => typeof r === 'string' || r.text))
}

// A finding as the editor first shows it: its text, then its citation markers.
export function asDrafted({
  text,
  citations,
}: {
  text: string
  citations: string[]
}): DocumentInline[] {
  return [
    ...(tidy(text) ? [{ type: 'text' as const, text: tidy(text) }] : []),
    ...citations.map((id) => ({ type: 'cite' as const, id })),
  ]
}

// One drafted statement as the content is built from it: its text and
// citations now, and whether it is out of the draft (rejected, RV-02).
type Statement = { text: string; citations: string[]; rejected: boolean }
type Drafted = { heading: string; kind: string; statements: Statement[] }[]

// The content of a section with these drafted subsections and, if current,
// this saved version. A block taken from the draft (a paragraph, list item or
// sub-heading) keeps its saved formatting while its words are still the
// finding's; a finding reworded in the review workspace since shows its new
// words, set as it was; a rejected one is left out; one restored, or never in
// the version, goes at the end of its subsection. Tables take no text.
function contentOf(drafted: Drafted | null, version: SectionDocument | null): SectionDocument {
  if (!drafted) return version ?? EMPTY_DOCUMENT
  const statements = new Map<string, Statement>(
    drafted.flatMap((sub, i) => sub.statements.map((st, j) => [`${i}.${j}`, st] as const)),
  )
  const placed = new Set<string>()
  const resolve = <T extends DocumentParagraph | DocumentHeading>(b: T): T | null => {
    if (!b.finding) return b
    const st = statements.get(b.finding)
    if (!st || st.rejected || placed.has(b.finding)) return null
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
  const subsections = drafted.map((sub, i) => ({
    heading: sub.heading,
    blocks: sub.kind === 'table' ? [] : resolveAll(version?.subsections[i]?.blocks ?? []),
  }))
  drafted.forEach((sub, i) =>
    sub.statements.forEach((st, j) => {
      const key = `${i}.${j}`
      if (sub.kind === 'table' || st.rejected || placed.has(key)) return
      placed.add(key)
      subsections[i].blocks.push({ type: 'paragraph', finding: key, content: asDrafted(st) })
    }),
  )
  return { intro, subsections }
}

const currentOf = (version: SectionVersion | null | undefined) =>
  version?.current ? version.document : null

// One of sections 4-12, with each finding's review decision.
export function sectionContent(section: ReviewSection): SectionDocument {
  return contentOf(
    section.draft?.subsections.map((sub) => ({
      heading: sub.heading,
      kind: sub.kind,
      statements: sub.statements.map((st) => ({
        text: st.text,
        citations: st.citations,
        rejected: st.review.state === 'rejected',
      })),
    })) ?? null,
    currentOf(section.document),
  )
}

// Section 2, the Executive Summary (GN-07): its statements are not reviewed
// one by one, so none is ever out of the draft.
export function summaryContent(
  draft: SectionDraft | null,
  version: SectionVersion | null,
): SectionDocument {
  return contentOf(
    draft?.subsections.map((sub) => ({
      heading: sub.heading,
      kind: sub.kind,
      statements: sub.statements.map((st) => ({ ...st, rejected: false })),
    })) ?? null,
    currentOf(version),
  )
}

// Sections 1, 3 and Appendix A: only what the engineer wrote.
export const partContent = (version: SectionVersion | null) => currentOf(version) ?? EMPTY_DOCUMENT

// Every block of text in some blocks: paragraphs, sub-headings and list items.
// A list's one member covers both kinds of list, so it is told apart from the
// others by elimination.
export const textBlocksIn = (blocks: DocumentBlock[]): (DocumentParagraph | DocumentHeading)[] =>
  blocks.flatMap((b) => (b.type === 'paragraph' || b.type === 'heading' ? [b] : b.items))

// Whether some blocks hold text the engineer wrote: a paragraph, list item or
// sub-heading not taken from the draft.
export const hasWritten = (blocks: DocumentBlock[]) =>
  textBlocksIn(blocks).some((b) => !b.finding && plainText(b.content))

// One number per cited source, in the order each is first cited in the
// section's text, so a number names the same source wherever it appears.
export function contentCitationNumbers(content: SectionDocument): Map<string, number> {
  const numbers = new Map<string, number>()
  const blocks = [...content.intro, ...content.subsections.flatMap((s) => s.blocks)]
  for (const { content: run } of textBlocksIn(blocks))
    for (const c of run)
      if (c.type === 'cite' && !numbers.has(c.id)) numbers.set(c.id, numbers.size + 1)
  return numbers
}
