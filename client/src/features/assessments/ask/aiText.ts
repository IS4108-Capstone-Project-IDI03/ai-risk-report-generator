// Text drafted from the Ask tab and inserted into a section (AS-04): which of
// its sentences are still unsupported, and where they are in a paragraph, to
// mark them in the review workspace's draft and in the document editor.
//
// A sentence proposed with no supporting source stays unsupported while it is
// in a paragraph of its proposal's text word for word, with no citation marker
// straight after it (AC3). Giving it a citation, rewording it or deleting it
// resolves it. The same rule as the gateway's
// server/src/services/section-document.ts unsupportedAiText: keep in step.
import type { DocumentInline, SectionDocument } from '../api'
import { MARKER } from '../comments/anchor'
import { textBlocksIn, tidy } from '../documentContent'

// A paragraph's text as the section's text holds it: its words, and each
// citation marker as U+FFFC.
export const markedText = (content: DocumentInline[]) =>
  content.map((c) => (c.type === 'text' ? c.text : MARKER)).join('')

// The text with each run of spacing as one space, and where each of its
// characters is in the text as written.
function spaced(text: string): { text: string; at: number[] } {
  let out = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text[i])
    if (space && out.endsWith(' ')) continue
    out += space ? ' ' : text[i]
    at.push(i)
  }
  return { text: out, at }
}

// Where each sentence still unsupported is in a paragraph's text (as
// `markedText` gives it, or an editor's equivalent), as [start, end) offsets,
// in the order given. A sentence not found, or with a citation marker
// straight after it, is left out.
export function unsupportedRanges(text: string, sentences: readonly string[]): [number, number][] {
  const { text: flat, at } = spaced(text)
  return sentences.flatMap((sentence): [number, number][] => {
    const words = tidy(sentence)
    const found = words ? flat.indexOf(words) : -1
    if (found < 0) return []
    const end = found + words.length
    if (flat.slice(end).trimStart().startsWith(MARKER)) return []
    return [[at[found], at[end - 1] + 1]]
  })
}

// The sentences still unsupported of each insertion of AI-drafted text in the
// section's text, by proposal; one with none is left out.
export function unsupportedIn(
  content: SectionDocument,
  drafts: readonly { id: string; unsupported: string[] }[],
): Map<string, string[]> {
  const blocks = textBlocksIn([...content.intro, ...content.subsections.flatMap((s) => s.blocks)])
  const found = new Map<string, string[]>()
  for (const draft of drafts) {
    const texts = blocks.flatMap((b) =>
      b.type === 'paragraph' && b.ai === draft.id ? [markedText(b.content)] : [],
    )
    const still = draft.unsupported.filter((sentence) =>
      texts.some((text) => unsupportedRanges(text, [sentence]).length > 0),
    )
    if (still.length) found.set(draft.id, still)
  }
  return found
}
