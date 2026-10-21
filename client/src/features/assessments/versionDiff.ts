// Comparing two texts of a report section (RV-06 AC3-AC5): what the newer
// adds to the older, what it deletes and what it changes, part by part (the
// text before the first subsection, then each subsection by heading), block
// by block (paragraphs, sub-headings and list items) and word by word. A word
// carries its formatting, so a word set in bold reads as changed; a citation
// marker is a word of its own. Spacing is not compared.
import type { DocumentBlock, DocumentInline, SectionDocument } from './api'

// A word with its formatting (marks sorted, comma-joined), or a citation
// marker; `space` when a space comes before it.
export type DiffWord = { kind: 'word'; text: string; marks: string; space: boolean }
export type DiffCite = { kind: 'cite'; id: string; space: boolean }
export type DiffToken = DiffWord | DiffCite

// How a block of text is set.
export type DiffShape = 'paragraph' | 'heading' | 'bulletList' | 'orderedList'

// A run of a compared block: words the two texts share, words only the newer
// has (added) or only the older has (deleted), and words the newer has in
// place of the older's (changed).
export type DiffSegment =
  | { op: 'same' | 'added' | 'deleted'; tokens: DiffToken[] }
  | { op: 'changed'; from: DiffToken[]; to: DiffToken[] }

export type DiffStatus = 'same' | 'added' | 'deleted' | 'changed'

// One block of the comparison: in both texts alike (same), only in the newer
// (added), only in the older (deleted), or in both with its words, setting or
// place changed (changed).
export type DiffBlock = {
  status: DiffStatus
  // How it is set: in the newer text, or in the older for a deleted block.
  shape: DiffShape
  // How the older text set it, when the newer sets it otherwise.
  shapeWas: DiffShape | null
  segments: DiffSegment[]
}

// The text before the first subsection (heading null), or a subsection.
export type DiffPart = { heading: string | null; blocks: DiffBlock[] }

// How many runs of words, or whole blocks, were added, deleted or changed.
export type DiffCounts = { added: number; deleted: number; changed: number }

export type SectionDiff = { parts: DiffPart[]; counts: DiffCounts }

type Block = {
  shape: DiffShape
  tokens: DiffToken[]
  // Each token as compared: its words and formatting, or its citation.
  keys: string[]
  // Its words alone, lower-cased, to tell how alike two blocks are.
  words: string[]
  // The whole block as compared, its setting included.
  id: string
}

type Step = 'same' | 'added' | 'deleted'

// Past this many cells, two blocks' words are compared as one change rather
// than word by word, so a very long section cannot stall the browser.
const MAX_CELLS = 4_000_000
// Two changed blocks are one block edited when this alike (Dice, by word).
const ALIKE = 0.4

// A paragraph's words and citation markers, in order.
export function tokensOf(content: DocumentInline[]): DiffToken[] {
  const tokens: DiffToken[] = []
  let space = false
  for (const c of content) {
    if (c.type === 'cite') {
      tokens.push({ kind: 'cite', id: c.id, space: space && tokens.length > 0 })
      space = false
      continue
    }
    const marks = [...(c.marks ?? [])].sort().join(',')
    for (const piece of c.text.split(/(\s+)/)) {
      if (!piece) continue
      if (/^\s+$/.test(piece)) space = true
      else {
        tokens.push({ kind: 'word', text: piece, marks, space: space && tokens.length > 0 })
        space = false
      }
    }
  }
  return tokens
}

const keyOf = (t: DiffToken) => (t.kind === 'cite' ? `\u0001${t.id}` : `${t.marks}\u0002${t.text}`)
const wordOf = (t: DiffToken) => (t.kind === 'cite' ? `\u0001${t.id}` : t.text.toLowerCase())

function block(shape: DiffShape, content: DocumentInline[]): Block {
  const tokens = tokensOf(content)
  const keys = tokens.map(keyOf)
  return {
    shape,
    tokens,
    keys,
    words: tokens.map(wordOf),
    id: `${shape}\u0003${keys.join('\u0004')}`,
  }
}

// Every block of text in some blocks, list items one by one; empty ones left out.
function blocksOf(blocks: DocumentBlock[]): Block[] {
  return blocks
    .flatMap((b) =>
      b.type === 'paragraph' || b.type === 'heading'
        ? [block(b.type, b.content)]
        : b.items.map((item) => block(b.type, item.content)),
    )
    .filter((b) => b.tokens.length > 0)
}

// The steps that turn `a` into `b` keeping their longest common subsequence:
// a shared item (same), one only in `a` (deleted) or one only in `b` (added).
function align(a: readonly string[], b: readonly string[]): Step[] {
  const repeat = (n: number, step: Step) => Array.from({ length: n }, () => step)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  const n = x.length
  const m = y.length
  const middle: Step[] = []
  if (!n || !m || n * m > MAX_CELLS) middle.push(...repeat(n, 'deleted'), ...repeat(m, 'added'))
  else {
    // lengths[i * w + j]: the longest common subsequence of x[i:] and y[j:].
    const w = m + 1
    const lengths = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lengths[i * w + j] =
          x[i] === y[j]
            ? lengths[(i + 1) * w + j + 1] + 1
            : Math.max(lengths[(i + 1) * w + j], lengths[i * w + j + 1])
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        middle.push('same')
        i++
        j++
      } else if (lengths[(i + 1) * w + j] >= lengths[i * w + j + 1]) {
        middle.push('deleted')
        i++
      } else {
        middle.push('added')
        j++
      }
    }
    middle.push(...repeat(n - i, 'deleted'), ...repeat(m - j, 'added'))
  }
  return [...repeat(start, 'same'), ...middle, ...repeat(a.length - endA, 'same')]
}

// A block's runs: shared words, and between them what was deleted, added, or
// deleted and added in its place (changed).
function segmentsOf(a: DiffToken[], b: DiffToken[], steps: Step[]): DiffSegment[] {
  const segments: DiffSegment[] = []
  let from: DiffToken[] = []
  let to: DiffToken[] = []
  const flush = () => {
    if (from.length && to.length) segments.push({ op: 'changed', from, to })
    else if (from.length) segments.push({ op: 'deleted', tokens: from })
    else if (to.length) segments.push({ op: 'added', tokens: to })
    from = []
    to = []
  }
  let i = 0
  let j = 0
  for (const step of steps) {
    if (step === 'deleted') from.push(a[i++])
    else if (step === 'added') to.push(b[j++])
    else {
      flush()
      const last = segments.at(-1)
      if (last?.op === 'same') last.tokens.push(b[j])
      else segments.push({ op: 'same', tokens: [b[j]] })
      i++
      j++
    }
  }
  flush()
  return segments
}

// How alike two blocks' words are, 0 to 1 (Dice's coefficient).
function similarity(a: Block, b: Block): number {
  if (!a.words.length || !b.words.length) return 0
  const left = new Map<string, number>()
  for (const w of a.words) left.set(w, (left.get(w) ?? 0) + 1)
  let common = 0
  for (const w of b.words) {
    const n = left.get(w) ?? 0
    if (n) {
      common++
      left.set(w, n - 1)
    }
  }
  return (2 * common) / (a.words.length + b.words.length)
}

const whole = (b: Block, status: 'added' | 'deleted'): DiffBlock => ({
  status,
  shape: b.shape,
  shapeWas: null,
  segments: [{ op: status, tokens: b.tokens }],
})
const edited = (a: Block, b: Block): DiffBlock => ({
  status: 'changed',
  shape: b.shape,
  shapeWas: a.shape === b.shape ? null : a.shape,
  segments: segmentsOf(a.tokens, b.tokens, align(a.keys, b.keys)),
})

// Between two shared blocks: pairs each newer block with the next older one
// much like it, as one block edited; the rest are deleted or added where
// they stood.
function pairUp(older: Block[], newer: Block[]): DiffBlock[] {
  const out: DiffBlock[] = []
  let i = 0
  for (const b of newer) {
    const k = older.findIndex((a, n) => n >= i && similarity(a, b) >= ALIKE)
    if (k < 0) {
      out.push(whole(b, 'added'))
      continue
    }
    for (; i < k; i++) out.push(whole(older[i], 'deleted'))
    out.push(edited(older[k], b))
    i = k + 1
  }
  for (; i < older.length; i++) out.push(whole(older[i], 'deleted'))
  return out
}

function diffBlocks(older: Block[], newer: Block[]): DiffBlock[] {
  const out: DiffBlock[] = []
  let gapOld: Block[] = []
  let gapNew: Block[] = []
  const flush = () => {
    out.push(...pairUp(gapOld, gapNew))
    gapOld = []
    gapNew = []
  }
  let i = 0
  let j = 0
  for (const step of align(
    older.map((b) => b.id),
    newer.map((b) => b.id),
  )) {
    if (step === 'deleted') gapOld.push(older[i++])
    else if (step === 'added') gapNew.push(newer[j++])
    else {
      flush()
      const b = newer[j]
      out.push({
        status: 'same',
        shape: b.shape,
        shapeWas: null,
        segments: [{ op: 'same', tokens: b.tokens }],
      })
      i++
      j++
    }
  }
  flush()
  return out
}

// Whether a changed block's words are all the same: it was only set
// differently, or moved.
export const wordsUnchanged = (b: DiffBlock) => b.segments.every((s) => s.op === 'same')

// Compares an older text of a section with a newer one: each part's blocks in
// the newer text's order, with a part only the older has after them.
export function diffSections(older: SectionDocument, newer: SectionDocument): SectionDiff {
  const partsOf = (d: SectionDocument) => [
    { heading: null, blocks: blocksOf(d.intro) },
    ...d.subsections.map((s) => ({
      heading: s.heading as string | null,
      blocks: blocksOf(s.blocks),
    })),
  ]
  const keyOfPart = (heading: string | null) => (heading === null ? '\u0000' : heading)
  const was = new Map(partsOf(older).map((p) => [keyOfPart(p.heading), p]))
  const parts: DiffPart[] = []
  for (const p of partsOf(newer)) {
    const key = keyOfPart(p.heading)
    parts.push({ heading: p.heading, blocks: diffBlocks(was.get(key)?.blocks ?? [], p.blocks) })
    was.delete(key)
  }
  for (const p of was.values()) parts.push({ heading: p.heading, blocks: diffBlocks(p.blocks, []) })

  const counts: DiffCounts = { added: 0, deleted: 0, changed: 0 }
  for (const b of parts.flatMap((p) => p.blocks)) {
    if (b.status === 'added') counts.added++
    else if (b.status === 'deleted') counts.deleted++
    else if (b.status === 'changed') {
      if (b.shapeWas || wordsUnchanged(b)) counts.changed++
      for (const s of b.segments)
        if (s.op === 'added') counts.added++
        else if (s.op === 'deleted') counts.deleted++
        else if (s.op === 'changed') counts.changed++
    }
  }
  return { parts: parts.filter((p) => p.blocks.length > 0), counts }
}

// Whether two texts of a section read the same.
export function sameText(a: SectionDocument, b: SectionDocument): boolean {
  const { added, deleted, changed } = diffSections(a, b).counts
  return added + deleted + changed === 0
}
