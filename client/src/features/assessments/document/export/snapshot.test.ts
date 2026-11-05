import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { fileNameOf } from '../../api'
import { toEditorJSON, type EditorSection } from '../convert'
import { programRowDecorations, programRowsOf } from '../page/programs'
import { documentExtensions } from '../schema'
import { photosIn, PRINT_DPI, printSize } from './snapshot'

// The export's pages (EX-01). jsdom lays nothing out, so how the pages are
// cut is checked on the server's sample pages; here, the rules that need no
// layout.

describe('photos at print resolution (AC8)', () => {
  it('draws a photo at 300 dpi of its printed size, in its own proportions', () => {
    // 4 inches wide on the page: 1,200 pixels at 300 dpi.
    expect(PRINT_DPI).toBe(300)
    expect(printSize({ width: 384, height: 288 }, { width: 4000, height: 3000 })).toEqual({
      width: 1200,
      height: 900,
    })
  })

  it('never draws a photo larger than the original holds', () => {
    expect(printSize({ width: 600, height: 450 }, { width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    })
  })

  it("takes the report's photos, not the empty image ProseMirror ends a paragraph with", () => {
    // A paragraph ending in a citation marker, as ProseMirror draws it.
    const root = document.createElement('div')
    root.innerHTML =
      '<p>Text<sup class="dm-cite"></sup><img class="ProseMirror-separator" alt=""><br class="ProseMirror-trailingBreak"></p>' +
      '<figure class="pg-photo"><img src="/api/observations/o1/photos/p1/image" alt=""></figure>'
    expect(photosIn(root).map((img) => img.getAttribute('src'))).toEqual([
      '/api/observations/o1/photos/p1/image',
    ])
  })
})

describe('the file name (AC1)', () => {
  it("reads the gateway's name, encoded or plain", () => {
    expect(
      fileNameOf(
        `attachment; filename="RPT-2026-0411 2026-11-04.pdf"; filename*=UTF-8''RPT-2026-0411%202026-11-04.pdf`,
        'x.pdf',
      ),
    ).toBe('RPT-2026-0411 2026-11-04.pdf')
    expect(fileNameOf('attachment; filename="RPT-2026-0411 2026-11-04.docx"', 'x')).toBe(
      'RPT-2026-0411 2026-11-04.docx',
    )
    expect(fileNameOf(null, 'RPT-2026-0411.pdf')).toBe('RPT-2026-0411.pdf')
  })
})

describe("Section 6's programs as Marsh's table (GN-11, AC7)", () => {
  const schema = getSchema(documentExtensions)
  const docOf = (section: EditorSection) => PMNode.fromJSON(schema, toEditorJSON([section]))

  const programs: EditorSection = {
    id: '6',
    label: '6. Management Programs',
    notices: [],
    locked: [],
    kinds: ['fields', 'narrative'],
    content: {
      intro: [],
      subsections: [
        {
          heading: 'Management Programs',
          blocks: [
            {
              type: 'paragraph',
              finding: '0.0',
              content: [
                { type: 'text', text: 'Housekeeping: Established. Aisles clear.' },
                { type: 'cite', id: 'O:o1' },
              ],
            },
            {
              type: 'paragraph',
              finding: '0.1',
              content: [
                { type: 'text', text: 'Hot Work Permit System: Formalized. Permits kept.' },
              ],
            },
            // A second row for one program, and the engineer's own text, stay paragraphs.
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Housekeeping: Embedded. A second look.' }],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Reviewed with the site.' }] },
          ],
        },
        {
          heading: 'Management Program Comments',
          blocks: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Comment.' },
                { type: 'cite', id: 'C:doc:1' },
                { type: 'cite', id: 'O:o1' },
              ],
            },
          ],
        },
      ],
    },
  }

  it('reads each program once, its rank and comment, and its citations as numbered', () => {
    const section = docOf(programs).child(0)
    let subsection = section.child(0)
    section.forEach((child) => {
      if (child.attrs.heading === 'Management Programs') subsection = child
    })
    // The subsection holds the part that draws the table, then its rows.
    expect(subsection.child(1).attrs.kind).toBe('programs')
    const { rows, placed } = programRowsOf(section, subsection)
    expect(rows).toEqual([
      { program: 'Housekeeping', rank: 'Established', comment: 'Aisles clear.', cites: [1] },
      {
        program: 'Hot Work Permit System',
        rank: 'Formalized',
        comment: 'Permits kept.',
        cites: [],
      },
    ])
    expect(placed.size).toBe(2)
  })

  it('marks the rows the table shows, for the page layout to hide', () => {
    const doc = docOf(programs)
    const marked = programRowDecorations(doc)
      .find()
      .map((d) => doc.nodeAt(d.from)?.textContent)
    expect(marked).toEqual([
      'Housekeeping: Established. Aisles clear.',
      'Hot Work Permit System: Formalized. Permits kept.',
    ])
  })
})
