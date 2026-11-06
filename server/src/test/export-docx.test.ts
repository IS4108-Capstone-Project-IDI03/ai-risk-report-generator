// The Word export (EX-01 AC5-AC8): written from the blocks read off the
// export pages, laid out like Marsh's reports.
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { bookmarkName, buildDocx } from '../services/export-docx'
import type { ExportDetails, ExportModel } from '../services/export-model'

const DETAILS: ExportDetails = {
  reference: 'RPT-2026-0411',
  client: 'Northgate Logistics',
  site: 'Tilbury Distribution Centre',
  address: null,
  assessmentType: 'Property risk survey',
  visitDate: '11 April 2026',
  engineer: 'Alex Rowe',
}

const MODEL: ExportModel = {
  blocks: [
    { kind: 'section', anchor: 'x-s-7', kicker: 'Section 7', number: '7.', title: 'Construction' },
    {
      kind: 'heading',
      level: 2,
      anchor: 'x-toc-1',
      runs: [{ text: 'Construction Narrative', bold: true }],
    },
    {
      kind: 'paragraph',
      paragraph: {
        runs: [
          { text: 'The roof is ' },
          { text: 'steel', bold: true },
          { text: '1', superscript: true },
        ],
      },
    },
    {
      kind: 'list',
      ordered: true,
      items: [{ runs: [{ text: 'First point.' }] }, { runs: [{ text: 'Second point.' }] }],
    },
    {
      kind: 'table',
      widths: [200, 100],
      headerRows: 1,
      rows: [
        [
          {
            paragraphs: [{ runs: [{ text: 'Program' }] }],
            header: true,
            colSpan: 1,
            rowSpan: 1,
            fill: null,
          },
          {
            paragraphs: [{ runs: [{ text: 'Maturity' }] }],
            header: true,
            colSpan: 1,
            rowSpan: 1,
            fill: null,
          },
        ],
        [
          {
            paragraphs: [{ runs: [{ text: 'Housekeeping' }] }],
            header: true,
            colSpan: 1,
            rowSpan: 1,
            fill: null,
          },
          {
            paragraphs: [{ runs: [{ text: 'Established' }] }],
            header: false,
            colSpan: 1,
            rowSpan: 1,
            fill: '#ffc100',
          },
        ],
      ],
    },
    { kind: 'pageBreak' },
    { kind: 'paragraph', paragraph: { runs: [{ text: 'Level II' }] } },
    { kind: 'section', anchor: 'x-s-R', kicker: null, number: '', title: 'References' },
  ],
  images: [],
  contents: [
    { level: 1, number: '7.', title: 'Construction', page: 1, anchor: 'x-s-7' },
    { level: 2, number: '', title: 'Construction Narrative', page: 1, anchor: 'x-toc-1' },
    { level: 1, number: '', title: 'References', page: 2, anchor: 'x-s-R' },
  ],
}

async function parts(model = MODEL) {
  const zip = await JSZip.loadAsync(await buildDocx(model, [], DETAILS))
  const read = (name: string) => zip.file(name)!.async('string')
  const footers = await Promise.all(
    Object.keys(zip.files)
      .filter((f) => /^word\/footer\d+\.xml$/.test(f))
      .map(read),
  )
  const headers = await Promise.all(
    Object.keys(zip.files)
      .filter((f) => /^word\/header\d+\.xml$/.test(f))
      .map(read),
  )
  return {
    document: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
    footers: footers.join(''),
    headers: headers.join(''),
  }
}

describe('the Word export (EX-01)', () => {
  it("uses Word's heading styles, each section from a new page (AC5)", async () => {
    const { document } = await parts()
    expect(document).toContain('<w:pStyle w:val="Heading1"/>')
    expect(document).toContain('<w:pStyle w:val="Heading2"/>')
    expect(document).toContain('<w:pageBreakBefore/>')
    // Linked from the contents by bookmark.
    expect(document).toContain(`w:name="${bookmarkName('x-s-7')}"`)
  })

  it('makes the contents a Word table of contents that updates (AC5)', async () => {
    const { document } = await parts()
    expect(document).toMatch(/<w:instrText[^>]*>TOC \\h \\o (&quot;|")1-2(&quot;|")<\/w:instrText>/)
    // Its entries read as Word builds them, linked to their headings.
    expect(document).toContain('Section 7 Construction')
    expect(document).toContain(`w:anchor="${bookmarkName('x-toc-1')}"`)
  })

  it('numbers the pages with Word fields: roman before the report, then from 1 (AC5)', async () => {
    const { document, footers, headers } = await parts()
    expect(footers).toMatch(/<w:instrText[^>]*>PAGE<\/w:instrText>/)
    expect(document).toContain('w:fmt="lowerRoman"')
    expect(document).toMatch(/<w:pgNumType w:start="1" w:fmt="decimal"\/>/)
    expect(headers).toContain('Property Risk Evaluation Report')
    expect(headers).toContain('Tilbury Distribution Centre')
    expect(footers).toContain('Marsh Advisory')
  })

  it('writes tables as Word tables, the header repeating and ranks coloured (AC5, AC7)', async () => {
    const { document } = await parts()
    expect(document).toContain('<w:tblHeader/>')
    expect(document).toContain('w:fill="FFC100"')
    // The details page too is a table, from the assessment's records.
    expect(document).toContain('Northgate Logistics')
    expect(document).toContain('Not entered')
  })

  it('keeps citations as superscript numbers, and lists as Word lists (AC6)', async () => {
    const { document } = await parts()
    expect(document).toMatch(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t[^>]*>1<\/w:t>/)
    expect(document).toContain('<w:numPr>')
  })

  it('gives every bookmark a name Word accepts', () => {
    expect(bookmarkName('x-toc-12')).toBe('x_x_toc_12')
    expect(bookmarkName('a'.repeat(60))).toHaveLength(40)
  })
})
