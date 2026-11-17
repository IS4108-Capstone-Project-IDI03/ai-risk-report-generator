// Where a comment thread is in the report (RV-03), as text rather than as an
// editor position, so it is found again in a later session and after the
// section changes outside the editor.
//
// A section's text is each text block the editor saves (convert.ts: its
// paragraphs, sub-headings and list items, in order, empty ones left out),
// joined by a line break, with a citation marker as U+FFFC. An editor
// position inside a block is then one character of that text, as text and
// markers take one position each. A thread's anchor is the offsets of its
// passage in that text, the passage itself and up to 32 characters either
// side: found at its offsets when the text is as it was; else where the same
// words stand with the most matching text around them; else, when its words
// were changed, between the text either side of them; else not at all.
import type { Node as PMNode } from '@tiptap/pm/model'
import { tidy } from '../documentContent'
import type { CommentAnchor } from './api'

export const MARKER = '￼'
// How much text either side of a passage its anchor keeps.
export const CONTEXT = 32
// The longest passage a thread can be on, as the gateway allows.
export const MAX_QUOTE = 10_000
// The least text either side that places a passage whose words changed.
const MIN_CONTEXT = 8

// One text block of a section: where it starts in the editor (`pos`) and in
// the text (`offset`), its length there, and the block itself.
export type Run = { pos: number; offset: number; length: number; node?: PMNode }
// A section's text, and where each of its blocks is.
export type SectionText = { sectionId: string; text: string; runs: Run[] }

// Whether the editor saves a text block: one with words, or a paragraph with
// a citation marker (convert.ts blocksOf).
function savedBlock(node: PMNode): boolean {
  const words = tidy(node.textContent) !== ''
  if (words || node.type.name === 'heading') return words
  let marker = false
  node.forEach((child) => {
    if (!child.isText) marker = true
  })
  return marker
}

function blockText(node: PMNode): string {
  let text = ''
  node.forEach((child) => {
    text += child.isText ? (child.text ?? '') : MARKER.repeat(child.nodeSize)
  })
  return text
}

// The text of a section, `at` being the editor position just before it.
export function sectionText(section: PMNode, at: number): SectionText {
  const runs: Run[] = []
  let text = ''
  section.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (savedBlock(node)) {
      if (runs.length) text += '\n'
      const words = blockText(node)
      runs.push({ pos: at + 1 + pos + 1, offset: text.length, length: words.length, node })
      text += words
    }
    return false
  })
  return { sectionId: section.attrs.id as string, text, runs }
}

// The section with this id, and the position just before it.
export function sectionNamed(doc: PMNode, sectionId: string): { node: PMNode; at: number } | null {
  let found: { node: PMNode; at: number } | null = null
  doc.forEach((node, at) => {
    if (!found && node.attrs.id === sectionId) found = { node, at }
  })
  return found
}

// The offset in the text of an editor position: a position outside every
// block moves to the next block's start (`start`) or the last one's end.
function offsetAt(text: SectionText, pos: number, side: 'start' | 'end'): number | null {
  const { runs } = text
  if (side === 'start') {
    for (const run of runs)
      if (pos <= run.pos + run.length) return run.offset + Math.max(0, pos - run.pos)
    return null
  }
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (pos >= run.pos) return run.offset + Math.min(run.length, pos - run.pos)
  }
  return null
}

// The editor position of an offset in the text; a line break between two
// blocks is the end of the first.
export function positionAt(text: SectionText, offset: number): number {
  let run = text.runs[0]
  for (const r of text.runs) if (r.offset <= offset) run = r
  return run.pos + Math.max(0, Math.min(offset - run.offset, run.length))
}

// Why a selection cannot be commented on, if it cannot.
export type Target = { anchor: CommentAnchor } | { reason: { title: string; text: string } }

// The text between two editor positions, in its section's text, or what is
// wrong with it: nothing selected, a selection across two sections, one with
// no words (only a fixed heading or a part filled in elsewhere), or one
// longer than `max`. Shared by comments and by asking about a passage (AS-02).
export type Selected =
  | { text: SectionText; start: number; end: number }
  | { problem: 'nothing' | 'sections' | 'words' | 'length' }
export function selectedText(doc: PMNode, from: number, to: number, max: number): Selected {
  if (to <= from) return { problem: 'nothing' }
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  if ($from.depth < 1 || $to.depth < 1 || $from.before(1) !== $to.before(1))
    return { problem: 'sections' }
  const text = sectionText($from.node(1), $from.before(1))
  const start = offsetAt(text, from, 'start')
  const end = offsetAt(text, to, 'end')
  const exact = start !== null && end !== null && end > start ? text.text.slice(start, end) : ''
  if (start === null || end === null || !tidy(exact.replaceAll(MARKER, ' ')))
    return { problem: 'words' }
  if (exact.length > max) return { problem: 'length' }
  return { text, start, end }
}

const CANT = "Can't comment here"

// The anchor of the text between two editor positions (AC1), or why there is
// none: nothing selected, a selection across two sections, one with no words
// (only a fixed heading or a part filled in elsewhere), or one too long.
export function commentTarget(doc: PMNode, from: number, to: number): Target {
  const selected = selectedText(doc, from, to, MAX_QUOTE)
  if ('text' in selected) return { anchor: anchorIn(selected.text, selected.start, selected.end) }
  const text = {
    nothing: 'Select the text to comment on.',
    sections: 'Select text within one section to comment on it.',
    words:
      'Select some of the text to comment on. Headings and parts filled in elsewhere take no comments.',
    length: `Select up to ${MAX_QUOTE.toLocaleString('en-GB')} characters to comment on.`,
  }[selected.problem]
  return { reason: { title: CANT, text } }
}

// The anchor of offsets in a section's text.
export function anchorIn(text: SectionText, start: number, end: number): CommentAnchor {
  return {
    sectionId: text.sectionId,
    start,
    end,
    exact: text.text.slice(start, end),
    prefix: text.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.text.slice(end, end + CONTEXT),
  }
}

// The anchor of an editor range in its first section, or null when it holds
// no text (AC6: the range a thread's text now covers, after edits).
export function anchorOfRange(doc: PMNode, from: number, to: number): CommentAnchor | null {
  if (to <= from) return null
  const $from = doc.resolve(from)
  if ($from.depth < 1) return null
  const text = sectionText($from.node(1), $from.before(1))
  const start = offsetAt(text, from, 'start')
  const last = offsetAt(text, Math.min(to, $from.end(1)), 'end')
  if (start === null || last === null || last <= start) return null
  return anchorIn(text, start, last)
}

function occurrences(text: string, part: string): number[] {
  const found: number[] = []
  if (!part) return found
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) found.push(at)
  return found
}

// How many characters two strings share at their start, or at their end.
function shared(a: string, b: string, atEnd: boolean): number {
  const max = Math.min(a.length, b.length)
  let n = 0
  while (n < max && (atEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++
  return n
}

// Where a passage is in its section's text now, as [start, end), or null.
export function locate(text: SectionText, anchor: CommentAnchor): [number, number] | null {
  const words = text.text
  const { start, end, exact, prefix, suffix } = anchor
  if (!exact) return null
  if (end <= words.length && words.slice(start, end) === exact) return [start, end]

  // The same words elsewhere: where the text around them matches best, then
  // the nearest.
  let best: { at: number; score: number; distance: number } | null = null
  for (const at of occurrences(words, exact)) {
    const score =
      shared(words.slice(Math.max(0, at - prefix.length), at), prefix, true) +
      shared(words.slice(at + exact.length, at + exact.length + suffix.length), suffix, false)
    const distance = Math.abs(at - start)
    if (!best || score > best.score || (score === best.score && distance < best.distance))
      best = { at, score, distance }
  }
  if (best) return [best.at, best.at + exact.length]

  // Its words were changed: what now stands between the text either side.
  // Context shorter than CONTEXT reached the section's start or end.
  const starts =
    prefix.length < CONTEXT
      ? words.startsWith(prefix)
        ? [prefix.length]
        : []
      : prefix.length >= MIN_CONTEXT
        ? occurrences(words, prefix).map((at) => at + prefix.length)
        : []
  const ends =
    suffix.length < CONTEXT
      ? words.endsWith(suffix)
        ? [words.length - suffix.length]
        : []
      : occurrences(words, suffix)
  const reach = exact.length * 2 + 200
  let pair: [number, number] | null = null
  for (const from of starts)
    for (const to of ends) {
      if (to <= from || to - from > reach) continue
      if (!pair || Math.abs(from - start) < Math.abs(pair[0] - start)) pair = [from, to]
    }
  if (!pair || !tidy(words.slice(pair[0], pair[1]).replaceAll(MARKER, ' '))) return null
  return pair
}

// The editor range of a thread's passage now, or null when it is not found.
export function rangeOf(doc: PMNode, anchor: CommentAnchor): { from: number; to: number } | null {
  const section = sectionNamed(doc, anchor.sectionId)
  if (!section) return null
  const text = sectionText(section.node, section.at)
  if (!text.runs.length) return null
  const found = locate(text, anchor)
  if (!found) return null
  const from = positionAt(text, found[0])
  const to = positionAt(text, found[1])
  return to > from ? { from, to } : null
}

// A passage as the comments show it: one line, markers left out.
export function quoteOf(exact: string, max = 160): string {
  const line = tidy(exact.replaceAll(MARKER, ' '))
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
