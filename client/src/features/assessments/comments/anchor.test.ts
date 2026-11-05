import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import type { DocumentBlock } from '../api'
import { fromEditorDoc, toEditorJSON, type EditorSection } from '../document/convert'
import { documentExtensions } from '../document/schema'
import {
  MARKER,
  anchorOfRange,
  commentTarget,
  locate,
  positionAt,
  rangeOf,
  sectionNamed,
  sectionText,
} from './anchor'
import { CommentAnchors, threadRanges } from './commentMarks'
import { stack } from './stack'

// Where a comment thread is in the report's text (RV-03): its anchor, and
// finding it again after the text changes (AC1, AC6).

const schema = getSchema([...documentExtensions, CommentAnchors])

const RISER = 'Riser penetrations were not fire-stopped at Level 3.'
const ROOF = 'The roof is of fire-resistive construction.'
const VALVES = 'Valves are checked weekly.'

const paragraph = (text: string, cite?: string): DocumentBlock => ({
  type: 'paragraph',
  content: [{ type: 'text', text }, ...(cite ? [{ type: 'cite' as const, id: cite }] : [])],
})
const section = (id: string, label: string, blocks: DocumentBlock[]): EditorSection => ({
  id,
  label,
  notices: [],
  locked: [],
  kinds: ['narrative'],
  content: { intro: [], subsections: [{ heading: 'Narrative', blocks }] },
})
const docOf = (seven: DocumentBlock[], nine: DocumentBlock[] = [paragraph(VALVES)]) =>
  schema.nodeFromJSON(
    toEditorJSON([
      section('7', '7. Construction', seven),
      section('9', '9. Fire Protection', nine),
    ]),
  )
const textOf = (doc: PMNode, id: string) => {
  const found = sectionNamed(doc, id)!
  return sectionText(found.node, found.at)
}
// The editor positions of some words in a section.
function rangeOfWords(doc: PMNode, id: string, words: string, nth = 0) {
  const text = textOf(doc, id)
  let at = -1
  for (let i = 0; i <= nth; i++) at = text.text.indexOf(words, at + 1)
  return { from: positionAt(text, at), to: positionAt(text, at + words.length) }
}

const DOC = docOf([paragraph(RISER, 'O:o1'), paragraph(ROOF)])
const anchorOn = (doc: PMNode, words: string, id = '7') => {
  const { from, to } = rangeOfWords(doc, id, words)
  const target = commentTarget(doc, from, to)
  if (!('anchor' in target)) throw new Error(target.reason.text)
  return target.anchor
}

describe("a section's text", () => {
  it('is its blocks in order, a citation marker as one character, one line each', () => {
    expect(textOf(DOC, '7').text).toBe(`${RISER}${MARKER}\n${ROOF}`)
  })

  it('maps each character to its place in the editor', () => {
    const { from, to } = rangeOfWords(DOC, '7', 'roof')
    expect(DOC.textBetween(from, to)).toBe('roof')
  })
})

describe('starting a thread (AC1)', () => {
  it('anchors the selected text by its place, its words and the text either side', () => {
    expect(anchorOn(DOC, 'not fire-stopped')).toEqual({
      sectionId: '7',
      start: 24,
      end: 40,
      exact: 'not fire-stopped',
      prefix: 'Riser penetrations were ',
      suffix: ` at Level 3.${MARKER}\nThe roof is of fir`,
    })
  })

  it('says why nothing selected, or text across two sections, takes no comment', () => {
    const at = rangeOfWords(DOC, '7', 'roof').from
    const none = commentTarget(DOC, at, at)
    expect('reason' in none && none.reason.text).toBe('Select the text to comment on.')

    const across = commentTarget(
      DOC,
      rangeOfWords(DOC, '7', 'roof').from,
      rangeOfWords(DOC, '9', 'weekly').to,
    )
    expect('reason' in across && across.reason.text).toBe(
      'Select text within one section to comment on it.',
    )
  })
})

describe('finding a thread again (AC6)', () => {
  const anchor = anchorOn(DOC, 'not fire-stopped')
  const found = (doc: PMNode) => {
    const range = rangeOf(doc, anchor)
    return range && doc.textBetween(range.from, range.to)
  }

  it('finds it where it was while the text is unchanged', () => {
    expect(locate(textOf(DOC, '7'), anchor)).toEqual([24, 40])
    expect(found(DOC)).toBe('not fire-stopped')
  })

  it('follows its words when text before them changes', () => {
    const moved = docOf([paragraph('A new opening line.'), paragraph(RISER, 'O:o1')])
    expect(found(moved)).toBe('not fire-stopped')
  })

  it('takes the copy of its words whose surroundings match, of several', () => {
    const fire = anchorOn(DOC, 'fire')
    const both = docOf([paragraph('Fire doors.'), paragraph(RISER, 'O:o1'), paragraph(ROOF)])
    const range = rangeOf(both, fire)!
    expect(both.textBetween(range.from, range.to)).toBe('fire')
    // The one in "fire-stopped", not the one in "fire-resistive".
    expect(both.textBetween(range.to, range.to + 8)).toBe('-stopped')
  })

  it('stays on what remains when its own words were changed', () => {
    const edited = docOf([
      paragraph('Riser penetrations were since sealed at Level 3.', 'O:o1'),
      paragraph(ROOF),
    ])
    expect(found(edited)).toBe('since sealed')
  })

  it('is not found once its text is deleted entirely', () => {
    expect(found(docOf([paragraph(ROOF)]))).toBeNull()
  })

  it('reads the anchor of the text a thread is on after edits', () => {
    const doc = docOf([paragraph('Riser penetrations were not yet fire-stopped at Level 3.')])
    const { from, to } = rangeOfWords(doc, '7', 'not yet fire-stopped')
    expect(anchorOfRange(doc, from, to)).toMatchObject({
      sectionId: '7',
      start: 24,
      end: 44,
      exact: 'not yet fire-stopped',
    })
  })
})

describe('the comment marks', () => {
  it('keep a thread on its words as they are edited, and lose it once they are deleted', () => {
    const { from, to } = rangeOfWords(DOC, '7', 'not fire-stopped')
    const mark = schema.marks.commentAnchor.create({ id: 't1' })
    let state = EditorState.create({ doc: DOC })
    state = state.apply(state.tr.addMark(from, to, mark))
    expect(threadRanges(state.doc).get('t1')).toEqual({ from, to, sectionId: '7' })

    // Typed inside the passage, words join it.
    state = state.apply(state.tr.insertText(' yet', from + 'not'.length))
    let range = threadRanges(state.doc).get('t1')!
    expect(state.doc.textBetween(range.from, range.to)).toBe('not yet fire-stopped')

    // Typed at its end, they do not.
    state = state.apply(state.tr.insertText('!', range.to))
    range = threadRanges(state.doc).get('t1')!
    expect(state.doc.textBetween(range.from, range.to)).toBe('not yet fire-stopped')

    // Deleted entirely, the thread has no passage.
    state = state.apply(state.tr.delete(range.from, range.to))
    expect(threadRanges(state.doc).has('t1')).toBe(false)
  })

  it('are never saved with the text', () => {
    const { from, to } = rangeOfWords(DOC, '7', 'roof')
    const state = EditorState.create({ doc: DOC })
    const marked = state.apply(
      state.tr.addMark(from, to, schema.marks.commentAnchor.create({ id: 't1' })),
    )
    expect(fromEditorDoc(marked.doc)).toEqual(fromEditorDoc(DOC))
  })
})

describe('placing cards in the margin', () => {
  it('keeps each card level with its text, pushing down one that would overlap', () => {
    expect(
      stack(
        [
          { id: 'a', top: 100, height: 80 },
          { id: 'b', top: 120, height: 40 },
          { id: 'c', top: 400, height: 40 },
        ],
        null,
      ),
    ).toEqual({ a: 100, b: 188, c: 400 })
  })

  it('keeps the chosen card level with its text, moving those above it up', () => {
    expect(
      stack(
        [
          { id: 'a', top: 100, height: 80 },
          { id: 'b', top: 120, height: 40 },
        ],
        'b',
      ),
    ).toEqual({ a: 32, b: 120 })
  })
})
