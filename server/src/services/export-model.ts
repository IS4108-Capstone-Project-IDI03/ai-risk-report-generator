// The report as the Word export reads it (EX-01): the blocks of the export
// pages' text in order, taken from the same pages the PDF prints
// (export-extract.ts), then written as a Word document (export-docx.ts).
// Plain data, so it crosses from the page to Node as JSON.

// A run of text with one formatting.
export type ExportRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  // A citation's number (AC6), or other raised text.
  superscript?: boolean
  // A line break inside the paragraph, instead of text.
  lineBreak?: boolean
  // #rrggbb, only where it is not the report's own text colour.
  color?: string
  // In points, only where it is not the report's 11pt.
  size?: number
  // A photo set in the text, e.g. in an OFI record's cell: its index in
  // ExportModel.images and its size in CSS pixels, instead of text.
  image?: { index: number; width: number; height: number }
}

export type ExportAlign = 'left' | 'center' | 'right'

export type ExportParagraph = {
  runs: ExportRun[]
  align?: ExportAlign
}

export type ExportCell = {
  paragraphs: ExportParagraph[]
  // A header cell (th): its row repeats on each page in Word.
  header: boolean
  colSpan: number
  rowSpan: number
  // #rrggbb background, e.g. a Section 6 maturity rank (AC7); null for none.
  fill: string | null
}

export type ExportBlock =
  // A report section (Section 7, Appendix A, References): it starts a page.
  | {
      kind: 'section'
      // The anchor the contents links to.
      anchor: string | null
      // "Section 7", "Appendix A"; null for References.
      kicker: string | null
      // "7.", "Appendix A:"; what the contents shows before the title.
      number: string
      title: string
    }
  // A sub-heading: level 2 when the contents lists it, 3 otherwise.
  | { kind: 'heading'; level: 2 | 3; anchor: string | null; runs: ExportRun[] }
  | { kind: 'paragraph'; paragraph: ExportParagraph }
  | { kind: 'list'; ordered: boolean; items: ExportParagraph[] }
  | {
      kind: 'table'
      // Column widths in CSS pixels, as laid out on the page.
      widths: number[]
      rows: ExportCell[][]
      // How many rows at the top are its header.
      headerRows: number
    }
  // A chart, legend or photo, by its index in ExportModel.images. Sizes are
  // in CSS pixels as laid out on the page.
  | { kind: 'image'; image: number; width: number; height: number; caption: ExportParagraph | null }
  // Where the page layout starts a page inside a section (a Section 5 loss level).
  | { kind: 'pageBreak' }

export type ExportImage =
  // A photo, as the export embedded it (at print resolution).
  | { source: 'data'; dataUrl: string }
  // A chart or legend, drawn by taking a picture of it on the page.
  | { source: 'screenshot'; selector: string }

// A contents entry, as the export's contents page lists it.
export type ExportContentsEntry = {
  level: 1 | 2
  number: string
  title: string
  page: number
  anchor: string | null
}

export type ExportModel = {
  blocks: ExportBlock[]
  images: ExportImage[]
  contents: ExportContentsEntry[]
}

// The cover and details page (RV-12 AC2), from the assessment's own records.
export type ExportDetails = {
  reference: string
  client: string | null
  site: string | null
  address: string | null
  assessmentType: string | null
  visitDate: string | null
  engineer: string | null
}
