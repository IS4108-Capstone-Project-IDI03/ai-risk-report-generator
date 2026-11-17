import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import type { DocumentBlock, SectionDocument } from '../api'
import { MARKER, commentTarget, positionAt, sectionNamed, sectionText } from '../comments/anchor'
import { toEditorJSON, type EditorSection } from '../document/convert'
import { documentExtensions } from '../document/schema'
import {
  contentText,
  editorPassage,
  MAX_PASSAGE,
  passageAt,
  passageIn,
  quotedWords,
} from './passage'

// AS-02: a passage selected in the draft, read the same way in the review
// workspace's draft editor and in the document editor, and kept as a comment
// thread's anchor is (RV-03).

const schema = getSchema(documentExtensions)

const SHUT = 'The B1 control valve was shut.'
const TAMPER = 'No tamper switch was fitted.'
const PUMP = 'The fire pump churn pressure was 10 bar.'
const content: SectionDocument = {
  intro: [{ type: 'paragraph', content: [{ type: 'text', text: 'Written by the engineer.' }] }],
  subsections: [
    {
      heading: 'Sprinkler Protection',
      blocks: [
        {
          type: 'paragraph',
          finding: '0.0',
          content: [
            { type: 'text', text: SHUT },
            { type: 'cite', id: 'O:o2' },
            { type: 'cite', id: 'C:fm:4' },
          ],
        },
        // Nothing in it: not part of the text, as the editor saves none.
        { type: 'paragraph', content: [] },
        {
          type: 'bulletList',
          items: [
            {
              type: 'paragraph',
              finding: '0.1',
              content: [
                { type: 'text', text: TAMPER, marks: ['bold'] },
                { type: 'cite', id: 'O:o2' },
              ],
            },
          ],
        },
      ],
    },
    { heading: 'Water Supplies', blocks: [] },
    {
      heading: 'Fire Pumps',
      blocks: [
        { type: 'heading', finding: '2.0', content: [{ type: 'text', text: 'Pump tests' }] },
        // Only a citation marker: kept, as the editor keeps it.
        { type: 'paragraph', content: [{ type: 'cite', id: 'C:fm:9' }] },
        {
          type: 'paragraph',
          finding: '2.1',
          content: [
            { type: 'text', text: PUMP },
            { type: 'cite', id: 'C:fm:9' },
          ],
        },
      ],
    },
  ],
}
const section = (id: string, label: string, body: SectionDocument): EditorSection => ({
  id,
  label,
  notices: [],
  locked: [],
  kinds: body.subsections.map(() => 'narrative'),
  content: body,
})
const other: SectionDocument = {
  intro: [],
  subsections: [
    {
      heading: 'Narrative',
      blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steel frame.' }] }],
    },
  ],
}
const doc = schema.nodeFromJSON(
  toEditorJSON([
    section('7', '7. Construction', other),
    section('9', '9. Fire Protection', content),
  ]),
)
const editorText = () => {
  const found = sectionNamed(doc, '9')!
  return sectionText(found.node, found.at)
}
const labelOf = (id: string) => ({ '7': '7. Construction', '9': '9. Fire Protection' })[id]!
const offsetsOf = (text: string, words: string) => {
  const start = text.indexOf(words)
  return [start, start + words.length] as const
}

describe("a section's text (AC3: RV-03's format)", () => {
  it('reads the same from the saved content as from the document editor', () => {
    const fromContent = contentText('9', content)
    const fromEditor = editorText()
    expect(fromContent.text).toBe(fromEditor.text)
    expect(fromContent.text).toBe(
      [
        'Written by the engineer.',
        `${SHUT}${MARKER}${MARKER}`,
        `${TAMPER}${MARKER}`,
        'Pump tests',
        MARKER,
        `${PUMP}${MARKER}`,
      ].join('\n'),
    )
    expect(fromContent.blocks.map((b) => b.offset)).toEqual(fromEditor.runs.map((r) => r.offset))
  })
})

describe('a passage (AC2)', () => {
  const text = contentText('9', content)

  it("brings the citations and findings of each block it is in, and an anchor as a comment's", () => {
    const [start, end] = offsetsOf(text.text, 'control valve')
    const target = passageIn(text, start, end, '9. Fire Protection')
    expect(target).toEqual({
      passage: {
        anchor: {
          sectionId: '9',
          start,
          end,
          exact: 'control valve',
          prefix: 'Written by the engineer.\nThe B1 ',
          suffix: ` was shut.${MARKER}${MARKER}\nNo tamper switch was fitted.`.slice(0, 32),
        },
        label: '9. Fire Protection',
        citations: ['O:o2', 'C:fm:4'],
        findings: ['0.0'],
      },
    })
    // The same words selected in the document editor make the same anchor.
    const editor = editorText()
    const comment = commentTarget(doc, positionAt(editor, start), positionAt(editor, end))
    expect(comment).toEqual({ anchor: 'passage' in target && target.passage.anchor })
  })

  it('across blocks, brings all of theirs, each once', () => {
    const start = text.text.indexOf('valve')
    const end = text.text.indexOf('switch')
    const target = passageIn(text, start, end, '9. Fire Protection')
    expect('passage' in target && target.passage).toMatchObject({
      citations: ['O:o2', 'C:fm:4'],
      findings: ['0.0', '0.1'],
    })
  })

  it('is read the same in the document editor, its finding keys without the section', () => {
    const editor = editorText()
    const [start, end] = offsetsOf(editor.text, '10 bar')
    const target = editorPassage(doc, positionAt(editor, start), positionAt(editor, end), labelOf)
    expect('passage' in target && target.passage).toMatchObject({
      anchor: { sectionId: '9', exact: '10 bar' },
      label: '9. Fire Protection',
      citations: ['C:fm:9'],
      findings: ['2.1'],
    })
  })

  it('says why one cannot be asked about', () => {
    const editor = editorText()
    const at = (words: string) => positionAt(editor, editor.text.indexOf(words))
    const reason = (from: number, to: number) => {
      const target = editorPassage(doc, from, to, labelOf)
      return 'reason' in target ? target.reason.text : null
    }
    expect(reason(at('Pump'), at('Pump'))).toBe('Select the text to ask about.')
    // Only a citation marker.
    const marker = editor.text.indexOf(`\n${MARKER}\n`) + 1
    expect(reason(positionAt(editor, marker), positionAt(editor, marker + 1))).toMatch(
      /^Select some of the text to ask about\./,
    )
    // Across two sections.
    const seven = sectionNamed(doc, '7')!
    expect(reason(seven.at + 3, at('Pump'))).toBe('Select text within one section to ask about it.')
    // Too long.
    const long = contentText('9', {
      intro: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(MAX_PASSAGE + 1) }] },
      ],
      subsections: [],
    })
    const tooLong = passageIn(long, 0, MAX_PASSAGE + 1, '9. Fire Protection')
    expect('reason' in tooLong && tooLong.reason.text).toBe(
      'Select up to 4,000 characters to ask about.',
    )
  })
})

describe('a passage asked about, later (AC3)', () => {
  const text = contentText('9', content)
  const [start, end] = offsetsOf(text.text, 'churn pressure')
  const asked = passageIn(text, start, end, '9. Fire Protection')
  const anchor = 'passage' in asked ? asked.passage.anchor : null!
  const edited = (blocks: DocumentBlock[]): SectionDocument => ({
    intro: [],
    subsections: [{ heading: 'Fire Pumps', blocks }],
  })

  it('is found where it now is after the text around it changes', () => {
    const now = contentText(
      '9',
      edited([
        { type: 'paragraph', content: [{ type: 'text', text: 'New opening line.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: PUMP }] },
      ]),
    )
    const found = passageAt(now, anchor)!
    expect(now.text.slice(...found)).toBe('churn pressure')
  })

  it('is not found once its text is deleted, so the message says "Text deleted"', () => {
    const now = contentText(
      '9',
      edited([{ type: 'paragraph', content: [{ type: 'text', text: 'Pumps were not tested.' }] }]),
    )
    expect(passageAt(now, anchor)).toBeNull()
    // Nor in another section.
    expect(passageAt(contentText('7', other), anchor)).toBeNull()
  })

  it('is quoted word for word, its citation markers left out', () => {
    expect(quotedWords(`${SHUT}${MARKER}${MARKER}\n${TAMPER}${MARKER}`)).toBe(`${SHUT}\n${TAMPER}`)
  })
})
