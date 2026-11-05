// Reads the export pages (EX-01) into the blocks the Word file is written
// from (export-model.ts). It runs inside the export page in Chromium
// (export-render.service.ts), so it is one self-contained function: nothing
// from outside it exists there. The pages are the same HTML the PDF prints,
// so both formats hold the same text, tables, charts and photos (AC6, AC7).
//
// What it relies on in the HTML, set by the browser when it laid the pages
// out (client document/export/snapshot.ts):
// - section[data-export-page="body"] for each page of the report, in order,
//   and section[data-export-page="contents"] for the contents;
// - data-x on a table or list split across pages, the same on each part, and
//   data-x-repeat on a table header repeated at the top of a page;
// - data-x-title, data-x-number and data-x-kicker on a section's heading;
//   data-x-toc on a sub-heading the contents lists;
// - data-x-kind="image" on a chart or legend, "photo" on a photo;
// - data-x-cite on a citation marker, holding its number;
// - data-x-break where the page layout starts a page inside a section;
// - data-x-skip on what is for screen readers only.
import type {
  ExportBlock,
  ExportCell,
  ExportContentsEntry,
  ExportImage,
  ExportModel,
  ExportParagraph,
  ExportRun,
} from './export-model'

export function extractReport(): ExportModel {
  // The little of the DOM this uses, typed here: the gateway has no DOM types.
  type Rect = { width: number; height: number }
  type Style = {
    display: string
    visibility: string
    fontWeight: string
    fontStyle: string
    textDecorationLine: string
    verticalAlign: string
    color: string
    fontSize: string
    backgroundColor: string
    textAlign: string
  }
  type Node = { nodeType: number; textContent: string | null; childNodes: ArrayLike<Node> }
  type El = Node & {
    tagName: string
    id: string
    children: ArrayLike<El>
    parentElement: El | null
    getAttribute(name: string): string | null
    hasAttribute(name: string): boolean
    setAttribute(name: string, value: string): void
    closest(selector: string): El | null
    querySelector(selector: string): El | null
    querySelectorAll(selector: string): ArrayLike<El>
    getBoundingClientRect(): Rect
    colSpan?: number
    rowSpan?: number
  }
  type Table = El & {
    tHead: El | null
    tBodies: ArrayLike<El>
    tFoot: El | null
    caption: El | null
  }
  const g = globalThis as unknown as {
    document: { querySelectorAll(selector: string): ArrayLike<El> }
    getComputedStyle(element: El): Style
  }
  const list = <T>(items: ArrayLike<T>): T[] => Array.from(items)
  const styleOf = (element: El) => g.getComputedStyle(element)

  const TEXT_COLOUR = '#202020'
  const BODY_SIZE = 11
  const blocks: ExportBlock[] = []
  const images: ExportImage[] = []
  // A table or list split across pages, by its data-x: later parts add to it.
  const tables = new Map<string, Extract<ExportBlock, { kind: 'table' }>>()
  const lists = new Map<string, Extract<ExportBlock, { kind: 'list' }>>()

  // "rgb(0, 44, 119)" as #002c77; null when transparent.
  function hex(colour: string): string | null {
    const match = /rgba?\(([^)]+)\)/.exec(colour)
    if (!match) return null
    const [r, gr, b, a] = match[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number)
    if (a !== undefined && a < 0.05) return null
    const two = (n: number) => Math.round(n).toString(16).padStart(2, '0')
    return `#${two(r)}${two(gr)}${two(b)}`
  }

  function shown(element: El): boolean {
    if (element.hasAttribute('data-x-skip')) return false
    const style = styleOf(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    // Visually hidden (for screen readers): clipped to a pixel.
    const rect = element.getBoundingClientRect()
    return !(rect.width <= 1 && rect.height <= 1 && element.tagName !== 'BR')
  }

  const pointsOf = (style: Style) => Math.round(parseFloat(style.fontSize) * 0.75 * 2) / 2

  // A photo set in the text, as the export embedded it.
  function imageRun(img: El): ExportRun | null {
    const src = img.getAttribute('src') ?? ''
    if (!/^data:image\/(jpeg|png);base64,/.test(src)) return null
    const rect = img.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return null
    images.push({ source: 'data', dataUrl: src })
    return { text: '', image: { index: images.length - 1, width: rect.width, height: rect.height } }
  }

  // The runs of an element's text, with the formatting each run is drawn in.
  function runsOf(element: El): ExportRun[] {
    return runsOfNodes(list(element.childNodes), element)
  }
  function runsOfNodes(nodes: Node[], parent: El): ExportRun[] {
    const runs: ExportRun[] = []
    const visit = (node: Node, parent: El) => {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ')
        if (!text) return
        const style = styleOf(parent)
        const run: ExportRun = { text }
        if (parseInt(style.fontWeight, 10) >= 600) run.bold = true
        if (style.fontStyle === 'italic') run.italic = true
        if (style.textDecorationLine.includes('underline')) run.underline = true
        if (style.verticalAlign === 'super' || parent.closest('sup')) run.superscript = true
        const colour = hex(style.color)
        if (colour && colour !== TEXT_COLOUR && colour !== '#000000') run.color = colour
        const size = pointsOf(style)
        if (Math.abs(size - BODY_SIZE) > 0.25) run.size = size
        runs.push(run)
        return
      }
      if (node.nodeType !== 1) return
      const element = node as El
      if (!shown(element)) return
      if (element.tagName === 'BR') {
        runs.push({ text: '', lineBreak: true })
        return
      }
      const cite = element.getAttribute('data-x-cite')
      if (cite !== null) {
        runs.push({ text: cite, superscript: true })
        return
      }
      if (element.tagName === 'IMG') {
        const image = imageRun(element)
        if (image) runs.push(image)
        return
      }
      // Icons and other drawings inside text are left out.
      if (element.tagName === 'svg' || element.tagName === 'SVG') return
      for (const child of list(element.childNodes)) visit(child, element)
    }
    for (const node of nodes) visit(node, parent)
    return tidy(runs)
  }

  // Joins runs drawn alike, and trims the paragraph's ends.
  function tidy(runs: ExportRun[]): ExportRun[] {
    const same = (a: ExportRun, b: ExportRun) =>
      !a.lineBreak &&
      !b.lineBreak &&
      !a.image &&
      !b.image &&
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.superscript === b.superscript &&
      a.color === b.color &&
      a.size === b.size
    const out: ExportRun[] = []
    for (const run of runs) {
      const last = out.at(-1)
      if (last && same(last, run)) last.text += run.text
      else out.push({ ...run })
    }
    while (out.length && out[0].lineBreak) out.shift()
    while (out.length && out.at(-1)!.lineBreak) out.pop()
    if (out.length) {
      out[0].text = out[0].text.replace(/^\s+/, '')
      out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
    }
    return out.filter((r) => r.lineBreak || r.image || r.text)
  }

  function paragraphOf(element: El): ExportParagraph {
    const align = styleOf(element).textAlign
    return {
      runs: runsOf(element),
      ...(align === 'center' ? { align: 'center' } : {}),
      ...(align === 'right' || align === 'end' ? { align: 'right' } : {}),
    }
  }
  const hasText = (p: ExportParagraph) => p.runs.some((r) => r.image || r.text.trim())

  const BLOCK = /^(block|flex|grid|table|list-item|flow-root)/
  const isBlock = (element: El) => BLOCK.test(styleOf(element).display)

  // A container's paragraphs: each block inside it, and the loose text and
  // photos between them, in order.
  function paragraphsOf(container: El): ExportParagraph[] {
    const out: ExportParagraph[] = []
    let inline: Node[] = []
    const flush = () => {
      if (!inline.length) return
      const p: ExportParagraph = { runs: runsOfNodes(inline, container) }
      if (hasText(p)) out.push(p)
      inline = []
    }
    for (const node of list(container.childNodes)) {
      const element = node.nodeType === 1 ? (node as El) : null
      if (!element || !shown(element) || !isBlock(element)) {
        inline.push(node)
        continue
      }
      flush()
      if (element.tagName === 'IMG') {
        const image = imageRun(element)
        if (image) out.push({ runs: [image] })
      } else if (element.tagName === 'UL' || element.tagName === 'OL')
        out.push(...list(element.children).map(paragraphOf).filter(hasText))
      else if (list(element.children).some((c) => shown(c) && isBlock(c)))
        out.push(...paragraphsOf(element))
      else {
        const p = paragraphOf(element)
        if (hasText(p)) out.push(p)
      }
    }
    flush()
    return out
  }

  function cellOf(cell: El): ExportCell {
    const fill = hex(styleOf(cell).backgroundColor)
    return {
      paragraphs: paragraphsOf(cell),
      header: cell.tagName === 'TH',
      colSpan: cell.colSpan ?? 1,
      rowSpan: cell.rowSpan ?? 1,
      fill: fill && fill !== '#ffffff' ? fill : null,
    }
  }

  // Column widths as laid out: from a row with one cell per column.
  function widthsOf(table: Table): number[] {
    const rows = list(table.querySelectorAll('tr')).filter(shown)
    const columns = Math.max(
      1,
      ...rows.map((r) => list(r.children).reduce((n, c) => n + (c.colSpan ?? 1), 0)),
    )
    const full = rows.find(
      (r) =>
        list(r.children).length === columns &&
        list(r.children).every((c) => (c.colSpan ?? 1) === 1),
    )
    if (full) return list(full.children).map((c) => c.getBoundingClientRect().width)
    const width = table.getBoundingClientRect().width
    return Array.from({ length: columns }, () => width / columns)
  }

  function table(element: El) {
    const t = element as Table
    const key = t.getAttribute('data-x')
    let block = key ? tables.get(key) : undefined
    const first = !block
    if (!block) {
      if (t.caption && shown(t.caption)) {
        const caption = paragraphOf(t.caption)
        caption.runs.forEach((r) => (r.bold = true))
        if (hasText(caption)) blocks.push({ kind: 'paragraph', paragraph: caption })
      }
      block = { kind: 'table', widths: widthsOf(t), rows: [], headerRows: 0 }
      blocks.push(block)
      if (key) tables.set(key, block)
    }
    const parts = [t.tHead, ...list(t.tBodies), t.tFoot].filter(
      (part): part is El => !!part && shown(part),
    )
    for (const part of parts) {
      const head = part === t.tHead
      if (head && (!first || part.hasAttribute('data-x-repeat'))) continue
      for (const row of list(part.children)) {
        if (row.tagName !== 'TR' || !shown(row)) continue
        block.rows.push(list(row.children).filter(shown).map(cellOf))
        if (head) block.headerRows += 1
      }
    }
  }

  function listBlock(element: El) {
    const key = element.getAttribute('data-x')
    let block = key ? lists.get(key) : undefined
    if (!block) {
      block = { kind: 'list', ordered: element.tagName === 'OL', items: [] }
      blocks.push(block)
      if (key) lists.set(key, block)
    }
    for (const item of list(element.children))
      if (item.tagName === 'LI' && shown(item)) {
        const p = paragraphOf(item)
        if (hasText(p)) block.items.push(p)
      }
  }

  function picture(element: El) {
    const index = images.length
    element.setAttribute('data-x-img', String(index))
    images.push({ source: 'screenshot', selector: `[data-x-img="${index}"]` })
    const rect = element.getBoundingClientRect()
    blocks.push({
      kind: 'image',
      image: index,
      width: rect.width,
      height: rect.height,
      caption: null,
    })
  }

  function photo(element: El) {
    const img = element.tagName === 'IMG' ? element : element.querySelector('img')
    if (!img) return
    const src = img.getAttribute('src') ?? ''
    if (!/^data:image\/(jpeg|png);base64,/.test(src)) {
      picture(element)
      return
    }
    const index = images.length
    images.push({ source: 'data', dataUrl: src })
    const rect = img.getBoundingClientRect()
    const figcaption = element.querySelector('figcaption')
    const caption = figcaption && shown(figcaption) ? paragraphOf(figcaption) : null
    blocks.push({
      kind: 'image',
      image: index,
      width: rect.width,
      height: rect.height,
      caption: caption && hasText(caption) ? { ...caption, align: 'center' } : null,
    })
  }

  function heading(element: El) {
    const title = element.getAttribute('data-x-title')
    if (title !== null) {
      blocks.push({
        kind: 'section',
        anchor: element.id || null,
        kicker: element.getAttribute('data-x-kicker') || null,
        number: element.getAttribute('data-x-number') ?? '',
        title,
      })
      return
    }
    const runs = runsOf(element)
    if (!runs.length) return
    blocks.push({
      kind: 'heading',
      level: element.getAttribute('data-x-toc') === '2' ? 2 : 3,
      anchor: element.id || null,
      runs,
    })
  }

  function visit(element: El) {
    if (!shown(element)) return
    if (element.hasAttribute('data-x-break')) blocks.push({ kind: 'pageBreak' })
    const tag = element.tagName
    const kind = element.getAttribute('data-x-kind')
    if (/^H[1-6]$/.test(tag)) heading(element)
    else if (kind === 'image') picture(element)
    else if (kind === 'photo') photo(element)
    else if (tag === 'TABLE') table(element)
    else if (tag === 'UL' || tag === 'OL') listBlock(element)
    else if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'FIGCAPTION') {
      const p = paragraphOf(element)
      if (hasText(p)) blocks.push({ kind: 'paragraph', paragraph: p })
    } else if (list(element.children).some((c) => shown(c) && isBlock(c))) {
      // A container: its blocks in order, any loose text between them a
      // paragraph of its own.
      for (const node of list(element.childNodes)) {
        if (node.nodeType === 1) visit(node as El)
        else if (node.nodeType === 3 && node.textContent?.trim())
          blocks.push({
            kind: 'paragraph',
            paragraph: { runs: [{ text: node.textContent.replace(/\s+/g, ' ').trim() }] },
          })
      }
    } else {
      const p = paragraphOf(element)
      if (hasText(p)) blocks.push({ kind: 'paragraph', paragraph: p })
    }
  }

  for (const page of list(g.document.querySelectorAll('section[data-export-page="body"]'))) {
    const root = page.querySelector('.dm-prose')
    if (root) for (const child of list(root.children)) visit(child)
  }

  const contents: ExportContentsEntry[] = list(
    g.document.querySelectorAll('section[data-export-page="contents"] [data-x-toc]'),
  ).map((entry) => ({
    level: entry.getAttribute('data-x-toc') === '2' ? 2 : 1,
    number: entry.querySelector('.pg-toc-number')?.textContent?.trim() ?? '',
    title: entry.querySelector('.pg-toc-title')?.textContent?.trim() ?? '',
    page: Number(entry.querySelector('.pg-toc-page')?.textContent?.trim()) || 0,
    anchor: (entry.getAttribute('href') ?? '').replace(/^#/, '') || null,
  }))

  return { blocks, images, contents }
}

// The text of each part of the export, to check that no masking placeholder
// is left in it (AC9): the cover and details pages, then each section of the
// report by its heading. Runs in the page, like extractReport.
export function partTexts(): { part: string; text: string }[] {
  type El = {
    textContent: string | null
    getAttribute(name: string): string | null
  }
  const g = globalThis as unknown as {
    document: { querySelectorAll(selector: string): ArrayLike<El> }
  }
  const out = new Map<string, string>()
  const add = (part: string, text: string | null) =>
    out.set(part, `${out.get(part) ?? ''} ${text ?? ''}`)
  for (const page of Array.from(g.document.querySelectorAll('section[data-export-page]'))) {
    const kind = page.getAttribute('data-export-page')
    if (kind === 'cover') add('The cover', page.textContent)
    else if (kind === 'details') add('The details page', page.textContent)
    else if (kind === 'contents') add('The contents', page.textContent)
  }
  for (const section of Array.from(g.document.querySelectorAll('[data-x-section]')))
    add(section.getAttribute('data-x-section') ?? 'The report', section.textContent)
  return [...out].map(([part, text]) => ({ part, text }))
}
