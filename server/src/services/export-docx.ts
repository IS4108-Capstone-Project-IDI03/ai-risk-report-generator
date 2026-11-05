// The report as a Word document (EX-01 AC5-AC8), written from the blocks
// read off the export pages (export-extract.ts), so it holds what the PDF
// holds. Laid out like Marsh's reports, as the page layout is (RV-12): a navy
// cover, the details page and contents numbered i, ii, and the report from 1,
// each page with Marsh's header and footer. Headings use Word's heading
// styles, the contents is a Word table of contents, page numbers are fields
// and tables are Word tables (AC5); charts and legends are pictures (AC7).
import { deflateSync } from 'zlib'
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  Header,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from 'docx'
import type {
  ExportBlock,
  ExportCell,
  ExportDetails,
  ExportModel,
  ExportParagraph,
  ExportRun,
} from './export-model'

// Marsh's colours, as the page layout uses them (design-system colors.css).
const NAVY = '002C77'
const BLUE = '009DE0'
const TEXT = '202020'
const RULE = '565656'
const WHITE = 'FFFFFF'

// The page, in twentieths of a point, as geometry.ts measures it in points:
// US Letter, 2.5 cm sides, 1 inch top and bottom, the header half an inch
// down and the footer 28pt up.
const PAGE = { width: 12240, height: 15840 }
const MARGIN = { top: 1440, bottom: 1440, left: 1417, right: 1417, header: 720, footer: 560 }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right
// CSS pixels (96 to the inch) in twips, and the text column in pixels.
const PX = 15
const CONTENT_PX = CONTENT_WIDTH / PX

const REPORT_TITLE = 'Property Risk Evaluation Report'
const FOOTER_LINES = ['Marsh Advisory', 'Consulting Solutions']
const NOT_ENTERED = 'Not entered'

const pt = (points: number) => Math.round(points * 20)
const half = (points: number) => Math.round(points * 2)
const shown = (value: string | null) => value ?? NOT_ENTERED

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const NO_BORDERS = {
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
}
const THIN = (color = 'A6A6A6'): IBorderOptions => ({ style: BorderStyle.SINGLE, size: 4, color })

// A one-colour PNG, for the cover's navy page.
function solidPng(hex: string, size = 8): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const row = Buffer.from([0, ...Array.from({ length: size }, () => rgb).flat()])
  const pixels = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// A bookmark name Word accepts: a letter first, then letters, digits and _.
export const bookmarkName = (anchor: string) =>
  `x_${anchor.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40)

type Picture = { data: Buffer; type: 'png' | 'jpg' }

// The runs of a paragraph; a photo among them at its laid-out size, narrowed
// to `maxWidth` CSS pixels.
function textRuns(
  runs: ExportRun[],
  base: { size?: number; color?: string } = {},
  pictures: Picture[] = [],
  maxWidth = CONTENT_PX,
): ParagraphChild[] {
  return runs.map((run) => {
    if (run.image) {
      const picture = pictures[run.image.index]
      if (!picture?.data.length) return new TextRun({ text: '' })
      const scale = run.image.width > maxWidth ? maxWidth / run.image.width : 1
      return new ImageRun({
        type: picture.type,
        data: picture.data,
        transformation: {
          width: Math.max(1, Math.round(run.image.width * scale)),
          height: Math.max(1, Math.round(run.image.height * scale)),
        },
        altText: { name: 'Photo', description: 'Site photo', title: 'Photo' },
      })
    }
    return run.lineBreak
      ? new TextRun({ text: '', break: 1 })
      : new TextRun({
          text: run.text,
          bold: run.bold,
          italics: run.italic,
          underline: run.underline ? {} : undefined,
          superScript: run.superscript,
          color: (run.color ?? (base.color ? `#${base.color}` : undefined))?.replace('#', ''),
          size: run.size ? half(run.size) : base.size ? half(base.size) : undefined,
        })
  })
}

const alignment = (p: ExportParagraph) =>
  p.align === 'center'
    ? AlignmentType.CENTER
    : p.align === 'right'
      ? AlignmentType.RIGHT
      : undefined

// The running header and footer of every page after the cover (RV-12 AC7),
// in two borderless columns: the report's title and its client and site, the
// footer's lines and the page number.
function band(left: string[], right: TextRun[]) {
  const size = half(8)
  const line = (
    children: ParagraphChild[],
    align?: (typeof AlignmentType)[keyof typeof AlignmentType],
  ) => new Paragraph({ children, alignment: align, spacing: { before: 0, after: 0, line: 200 } })
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: left.map((text) => line([new TextRun({ text, size })])),
          }),
          new TableCell({
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            children: right.map((run) => line([run], AlignmentType.RIGHT)),
          }),
        ],
      }),
    ],
  })
}

function pageHeader(details: ExportDetails) {
  return new Header({
    children: [
      band(
        [REPORT_TITLE],
        [
          new TextRun({ text: shown(details.client), size: half(8) }),
          new TextRun({ text: shown(details.site), size: half(8) }),
        ],
      ),
      new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [] }),
    ],
  })
}

function pageFooter() {
  return new Footer({
    children: [
      band(FOOTER_LINES, [new TextRun({ children: [PageNumber.CURRENT], size: half(8) })]),
      new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [] }),
    ],
  })
}

// The cover (RV-12 AC2): navy, with the wordmark, title, address, site and
// visit date in white, as the page layout draws it.
function cover(details: ExportDetails) {
  const navy = new ImageRun({
    type: 'png',
    data: solidPng(NAVY),
    transformation: { width: PAGE.width / PX, height: PAGE.height / PX },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
      behindDocument: true,
      allowOverlap: true,
    },
    altText: { name: 'Cover background', description: 'Marsh navy', title: 'Cover' },
  })
  const line = (
    text: string,
    size: number,
    lineHeight: number,
    before: number,
    bold = false,
    extra: ParagraphChild[] = [],
  ) =>
    new Paragraph({
      spacing: { before: pt(before), after: 0, line: pt(lineHeight), lineRule: 'exact' },
      // The title wraps at 340pt, as on the page.
      indent: size >= 38 ? { right: CONTENT_WIDTH - pt(340) } : undefined,
      children: [...extra, new TextRun({ text, size: half(size), bold, color: WHITE })],
    })
  return [
    line('MARSH', 22, 26, 0, true, [navy]),
    line(REPORT_TITLE, 38, 44, 58, true),
    line(shown(details.address), 24, 28, 54),
    line(shown(details.site), 22, 26, 30, true),
    line(shown(details.visitDate), 14, 17, 18),
  ]
}

function coverFooter() {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: 'A business of Marsh McLennan', size: half(10), color: WHITE }),
        ],
      }),
    ],
  })
}

// Marsh's page i: the client, then what was surveyed, by whom and when.
function detailsPage(details: ExportDetails) {
  const rows: [string, string | null][] = [
    ['Location Surveyed', details.site],
    ['Address', details.address],
    ['Surveyed By', details.engineer],
    ['Survey Dates', details.visitDate],
    ['Survey Type', details.assessmentType],
    ['Report Reference', details.reference],
  ]
  const label = pt(116)
  const rule = (last: boolean) => ({
    top: NONE,
    left: NONE,
    right: NONE,
    bottom: { style: BorderStyle.SINGLE, size: last ? 16 : 6, color: RULE },
  })
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [label, CONTENT_WIDTH - label],
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            columnSpan: 2,
            borders: NO_BORDERS,
            shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
            children: [
              new Paragraph({
                spacing: { before: pt(3), after: pt(3) },
                children: [new TextRun({ text: shown(details.client), color: WHITE })],
              }),
            ],
          }),
        ],
      }),
      ...rows.map(
        ([name, value], i) =>
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                borders: rule(i === rows.length - 1),
                children: [
                  new Paragraph({
                    spacing: { before: pt(3.5), after: pt(3.5) },
                    children: [new TextRun({ text: name, bold: true })],
                  }),
                ],
              }),
              new TableCell({
                borders: rule(i === rows.length - 1),
                children: [
                  new Paragraph({
                    spacing: { before: pt(3.5), after: pt(3.5) },
                    children: [new TextRun({ text: shown(value) })],
                  }),
                ],
              }),
            ],
          }),
      ),
    ],
  })
}

// An image at its laid-out size, narrowed to the text column if wider.
function imageParagraph(picture: Picture, width: number, height: number, name: string): Paragraph {
  const scale = width > CONTENT_PX ? CONTENT_PX / width : 1
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { before: 0, after: pt(6) },
    children: [
      new ImageRun({
        type: picture.type,
        data: picture.data,
        transformation: {
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        },
        altText: { name, description: name, title: name },
      }),
    ],
  })
}

function cellOf(cell: ExportCell, width: number, pictures: Picture[]): TableCell {
  const paragraphs = cell.paragraphs.length ? cell.paragraphs : [{ runs: [] }]
  return new TableCell({
    columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
    rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
    width: { size: width, type: WidthType.DXA },
    shading: cell.fill
      ? { type: ShadingType.CLEAR, fill: cell.fill.replace('#', '').toUpperCase(), color: 'auto' }
      : undefined,
    margins: { top: pt(2), bottom: pt(2), left: pt(4), right: pt(4) },
    children: paragraphs.map(
      (p) =>
        new Paragraph({
          alignment: alignment(p),
          spacing: { before: 0, after: 0 },
          children: textRuns(
            cell.header ? p.runs.map((r) => ({ ...r, bold: r.bold ?? true })) : p.runs,
            { size: 10 },
            pictures,
            // Within the cell, its margins taken off.
            Math.max(24, width / PX - 12),
          ),
        }),
    ),
  })
}

function tableOf(block: Extract<ExportBlock, { kind: 'table' }>, pictures: Picture[]): Table {
  const total = block.widths.reduce((a, b) => a + b, 0) || 1
  const width = Math.min(CONTENT_WIDTH, Math.round(total * PX))
  const columns = block.widths.map((w) => Math.max(pt(12), Math.round((w / total) * width)))
  const spanWidth = (start: number, span: number) =>
    columns.slice(start, start + span).reduce((a, b) => a + b, 0)
  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: columns,
    layout: TableLayoutType.FIXED,
    borders: {
      top: THIN(),
      bottom: THIN(),
      left: THIN(),
      right: THIN(),
      insideHorizontal: THIN(),
      insideVertical: THIN(),
    },
    rows: block.rows.map((cells, i) => {
      let column = 0
      return new TableRow({
        tableHeader: i < block.headerRows,
        cantSplit: true,
        children: cells.map((cell) => {
          const made = cellOf(cell, spanWidth(column, cell.colSpan), pictures)
          column += cell.colSpan
          return made
        }),
      })
    }),
  })
}

// The report's own pages: each section from a new page under its heading.
function body(model: ExportModel, pictures: Picture[]) {
  const out: (Paragraph | Table)[] = []
  let lists = 0
  let afterSection = false
  model.blocks.forEach((block, index) => {
    const startsSection = block.kind === 'section'
    if (block.kind === 'pageBreak') {
      if (!afterSection) out.push(new Paragraph({ children: [new PageBreak()] }))
      return
    }
    afterSection = startsSection
    switch (block.kind) {
      case 'section': {
        const runs: TextRun[] = [
          ...(block.kicker
            ? [
                new TextRun({ text: block.kicker, size: half(18), color: BLUE }),
                new TextRun({ text: '', break: 1 }),
              ]
            : []),
          new TextRun({ text: block.title, size: half(28), bold: true, color: NAVY }),
        ]
        out.push(
          new Paragraph({
            style: 'Heading1',
            pageBreakBefore: index > 0,
            children: block.anchor
              ? [new Bookmark({ id: bookmarkName(block.anchor), children: runs })]
              : runs,
          }),
        )
        break
      }
      case 'heading': {
        const runs = textRuns(block.runs.map((r) => ({ ...r, size: undefined, color: undefined })))
        out.push(
          new Paragraph({
            style: block.level === 2 ? 'Heading2' : 'Heading3',
            children: block.anchor
              ? [new Bookmark({ id: bookmarkName(block.anchor), children: runs })]
              : runs,
          }),
        )
        break
      }
      case 'paragraph':
        out.push(
          new Paragraph({
            alignment: alignment(block.paragraph),
            children: textRuns(block.paragraph.runs, {}, pictures),
          }),
        )
        break
      case 'list': {
        lists += 1
        const instance = lists
        for (const item of block.items)
          out.push(
            new Paragraph({
              ...(block.ordered
                ? { numbering: { reference: 'report-numbered', level: 0, instance } }
                : { bullet: { level: 0 } }),
              spacing: { after: pt(3) },
              children: textRuns(item.runs, {}, pictures),
            }),
          )
        break
      }
      case 'table':
        if (block.rows.length) {
          out.push(tableOf(block, pictures))
          // Space after a table, as the page has.
          out.push(new Paragraph({ spacing: { before: 0, after: pt(6) }, children: [] }))
        }
        break
      case 'image': {
        const picture = pictures[block.image]
        if (!picture?.data.length) break
        out.push(imageParagraph(picture, block.width, block.height, `Figure ${block.image + 1}`))
        if (block.caption)
          out.push(new Paragraph({ style: 'Caption', children: textRuns(block.caption.runs) }))
        break
      }
    }
  })
  return out
}

export async function buildDocx(
  model: ExportModel,
  pictures: Picture[],
  details: ExportDetails,
): Promise<Buffer> {
  const page = { size: PAGE, margin: MARGIN }
  // The contents as the export's contents page lists it, each entry linking to
  // its heading; Word refreshes the page numbers to its own pagination.
  const cachedEntries = model.contents.map((entry) => {
    const section = model.blocks.find(
      (b) => b.kind === 'section' && b.anchor && b.anchor === entry.anchor,
    )
    // A section's entry reads as Word builds it from the heading: its kicker,
    // then its title ("Section 7 Construction").
    const title =
      entry.level === 1 && section?.kind === 'section' && section.kicker
        ? `${section.kicker} ${section.title}`
        : entry.title
    return {
      title,
      level: entry.level,
      page: entry.page,
      ...(entry.anchor ? { href: bookmarkName(entry.anchor) } : {}),
    }
  })

  const doc = new Document({
    creator: details.engineer ?? 'Marsh',
    title: `${details.reference} ${REPORT_TITLE}`,
    description: `${REPORT_TITLE} for ${shown(details.site)}`,
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: half(11), color: TEXT },
          // Arial 11pt on 13pt lines, as Marsh sets it.
          paragraph: { spacing: { before: 0, after: pt(9), line: 283, lineRule: 'auto' } },
        },
        heading1: {
          run: { font: 'Arial', size: half(28), color: NAVY },
          paragraph: { spacing: { before: 0, after: pt(18) }, keepNext: true },
        },
        heading2: {
          run: { font: 'Arial', size: half(14), bold: true, color: BLUE },
          paragraph: { spacing: { before: pt(14), after: pt(6) }, keepNext: true },
        },
        heading3: {
          run: { font: 'Arial', size: half(12), bold: true, color: TEXT },
          paragraph: { spacing: { before: pt(12), after: pt(4) }, keepNext: true },
        },
      },
      paragraphStyles: [
        {
          id: 'Caption',
          name: 'caption',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: half(10) },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: pt(12) } },
        },
        {
          id: 'TOC1',
          name: 'toc 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: half(11) },
          paragraph: { spacing: { before: pt(8), after: pt(8) } },
        },
        {
          id: 'TOC2',
          name: 'toc 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: half(10) },
          paragraph: { indent: { left: pt(22) }, spacing: { before: pt(3), after: pt(3) } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'report-numbered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: pt(18), hanging: pt(18) } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page },
        footers: { default: coverFooter() },
        children: cover(details),
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } },
        },
        headers: { default: pageHeader(details) },
        footers: { default: pageFooter() },
        children: [
          new Paragraph({ spacing: { before: pt(27), after: 0 }, children: [] }),
          detailsPage(details),
          new Paragraph({
            pageBreakBefore: true,
            spacing: { before: pt(24), after: pt(24), line: pt(32), lineRule: 'exact' },
            children: [new TextRun({ text: 'Contents', size: half(28), bold: true, color: NAVY })],
          }),
          new TableOfContents('Contents', {
            hyperlink: true,
            headingStyleRange: '1-2',
            cachedEntries,
            beginDirty: true,
          }),
        ],
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
        },
        headers: { default: pageHeader(details) },
        footers: { default: pageFooter() },
        children: body(model, pictures),
      },
    ],
  })
  return await Packer.toBuffer(doc)
}
