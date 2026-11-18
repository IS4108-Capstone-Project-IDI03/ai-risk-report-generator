// The export's pages as one HTML document (EX-01), for the gateway to print
// as the PDF and read into the Word file. Built from the export render of
// Marsh's page layout (ExportPages.tsx) once it has settled: the same
// cover, details page and contents, and the report cut into Letter pages
// exactly where the layout breaks them (AC3), each page with its header and
// footer. Every block of the report keeps the page the layout gave it, and
// sits where it sat on that page; a table carried onto a page starts with
// its header again, as on screen.
//
// Also marks what the Word file needs to know (server export-extract.ts):
// each section's number and title, the contents' targets, citations,
// charts and photos, and the parts of a table or list split across pages.
// Photos go in at print resolution (PRINT_DPI); the stored originals are
// never changed (AC8).
import type { EditorView } from '@tiptap/pm/view'
import { contentsNumber } from '../page/frontMatter'
import { MARSH_GEOMETRY } from '../page/geometry'
import { measureUnits, type MeasuredUnit } from '../page/measure'
import { paginate } from '../page/paginate'

// Photos at 300 dots to the inch of their printed size, never above the
// original's own resolution (AC8).
export const PRINT_DPI = 300
const JPEG_QUALITY = 0.9

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

export type SnapshotPart = { id: string; number: string; title: string }

// Laid out at its printed size, so each page prints as one Letter page.
export const EXPORT_CSS = `
@page { size: 612pt 792pt; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.dm-sheet.is-export { width: 612pt; margin: 0; }
.dm-sheet.is-export .pg-page {
  margin: 0;
  box-shadow: none;
  break-after: page;
  break-inside: avoid;
}
.dm-sheet.is-export .pg-page:last-child { break-after: auto; }
.dm-sheet.is-export .pg-body-page .dm-body { position: absolute; inset: 0; }
.dm-sheet.is-export .pg-body-page .dm-paper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.dm-sheet.is-export a.pg-toc-link { color: inherit; text-decoration: none; }
`

const PHOTO = 'figure.pg-photo, img'
const PICTURE = 'figure, svg, canvas, .rv-legend, .rv-charts-grid'
const TABLE_PART = new Set(['TR', 'THEAD', 'TBODY', 'TFOOT', 'CAPTION'])
// Starts a page in Word too, as it does in the layout (measure.ts NEW_PAGE).
const NEW_PAGE = '.rv-figures-level'
// For screen readers only: in the PDF's text, not drawn in the Word file.
const SCREEN_READER_ONLY = '.rv-sr-only, .dm-visually-hidden'

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Every stylesheet the app has loaded, as text: the pages need the same rules.
// An imported sheet's rules are read in its place; one from another origin
// (the web fonts) is left out, as the export loads nothing.
export function documentCss(doc: Document = document): string {
  const rules: string[] = []
  const read = (sheet: CSSStyleSheet) => {
    let list: CSSRule[]
    try {
      list = Array.from(sheet.cssRules)
    } catch {
      return
    }
    for (const rule of list)
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) read(rule.styleSheet)
      } else rules.push(rule.cssText)
  }
  for (const sheet of Array.from(doc.styleSheets)) read(sheet)
  return rules.join('\n')
}

// Pairs each element of a tree with its copy in a deep clone of it.
function pairUp(original: Element, copy: Element, into: Map<Element, Element>) {
  into.set(original, copy)
  const a = original.children
  const b = copy.children
  for (let i = 0; i < a.length; i += 1) pairUp(a[i], b[i], into)
}

// A photo as a JPEG at print resolution: its printed size at PRINT_DPI,
// never more than the image itself holds, in its own proportions.
export function printSize(
  shown: { width: number; height: number },
  natural: { width: number; height: number },
) {
  const scale = PRINT_DPI / 96
  const width = Math.min(natural.width, Math.round(shown.width * scale))
  return {
    width: Math.max(1, width),
    height: Math.max(1, Math.round((width * natural.height) / natural.width)),
  }
}

// ProseMirror's separator: an empty <img> it puts after an inline node that
// ends a paragraph (a citation marker, say), for the cursor. It holds no picture.
const SEPARATOR = 'img.ProseMirror-separator'

// The photos in the pages: every image but ProseMirror's separators.
export function photosIn(root: ParentNode): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>(`img:not(${SEPARATOR})`))
}

function photoData(img: HTMLImageElement): string {
  if (!img.complete || !img.naturalWidth)
    throw new SnapshotError(
      'A photo in the report has not loaded, so the report was not exported. Check your connection and try again.',
    )
  const rect = img.getBoundingClientRect()
  const size = printSize(rect, { width: img.naturalWidth, height: img.naturalHeight })
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new SnapshotError('This browser cannot prepare the photos for export.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(img, 0, 0, size.width, size.height)
  try {
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } catch {
    throw new SnapshotError('A photo in the report could not be read for export.')
  }
}

// What the contents lists, in order, each with the element it opens on: as
// contentsEntries lists them, a section's heading then its sub-headings.
function contentsTargets(parts: SnapshotPart[], units: MeasuredUnit[]) {
  const out: { element: Element; level: 1 | 2; sectionId: string }[] = []
  for (const part of parts) {
    const own = units.filter((u) => u.heading?.sectionId === part.id)
    const opening = own.find((u) => u.heading!.level === 1)
    if (!opening) continue
    out.push({ element: opening.element, level: 1, sectionId: part.id })
    for (const unit of own)
      if (unit.heading!.level === 2)
        out.push({ element: unit.element, level: 2, sectionId: part.id })
  }
  return out
}

export type SnapshotInput = {
  // The export render's sheet: front pages, then the body with its bands.
  sheet: HTMLElement
  view: EditorView
  parts: SnapshotPart[]
  title: string
  css?: string
}

export function snapshotPages({ sheet, view, parts, title, css }: SnapshotInput): string {
  const { units, measurable } = measureUnits(view)
  if (!measurable) throw new SnapshotError('The report could not be laid out in pages.')
  const layout = paginate(units, MARSH_GEOMETRY)

  // One copy of everything, marked up; each page then takes its share of it.
  const master = sheet.cloneNode(true) as HTMLElement
  const copyOf = new Map<Element, Element>()
  pairUp(sheet, master, copyOf)

  // Photos at print resolution, in place of their gateway addresses. The
  // separators are an editing aid, drawn at no size: left out.
  for (const separator of Array.from(master.querySelectorAll(SEPARATOR))) separator.remove()
  for (const img of photosIn(sheet))
    (copyOf.get(img) as HTMLImageElement).setAttribute('src', photoData(img))
  for (const canvas of Array.from(sheet.querySelectorAll('canvas'))) {
    const img = document.createElement('img')
    img.src = canvas.toDataURL('image/png')
    img.width = canvas.width
    img.style.width = `${canvas.getBoundingClientRect().width}px`
    copyOf.get(canvas)!.replaceWith(img)
    copyOf.set(canvas, img)
  }

  // The page each block is on, and where it was moved down to start one.
  units.forEach((unit, i) => {
    const copy = copyOf.get(unit.element) as HTMLElement
    copy.setAttribute('data-pg-page', String(layout.pageOf[i]))
    copy.setAttribute('data-pg-base', String(unit.basePadding))
    if (TABLE_PART.has(copy.tagName)) return
    if (copy.matches(PHOTO)) copy.setAttribute('data-x-kind', 'photo')
    else if (copy.matches(PICTURE) || copy.querySelector('svg.recharts-surface'))
      copy.setAttribute('data-x-kind', 'image')
  })

  // A legend beside a table is pictured in Word too, as it is drawn (AC7).
  for (const legend of Array.from(master.querySelectorAll('.rv-legend')))
    legend.setAttribute('data-x-kind', 'image')

  // Each section: its heading's number, kicker and title (for Word), and its
  // name (for the gateway's placeholder check, AC9).
  const byId = new Map(parts.map((p) => [p.id, p]))
  for (const section of Array.from(master.querySelectorAll<HTMLElement>('section.dm-section'))) {
    const id = section.getAttribute('data-section') ?? ''
    const part = byId.get(id)
    if (!part) continue
    const number = contentsNumber(part.number)
    section.setAttribute(
      'data-x-section',
      part.id === 'A'
        ? `Appendix A. ${part.title}`
        : part.number
          ? `Section ${part.number}. ${part.title}`
          : part.title,
    )
    const heading = section.querySelector('h2')
    if (!heading) continue
    heading.setAttribute('data-x-title', part.title)
    heading.setAttribute('data-x-number', number)
    heading.setAttribute('data-x-kicker', heading.getAttribute('data-kicker') ?? '')
    heading.id = `x-s-${id}`
  }

  // The contents' targets: each entry links to its heading (AC4).
  const targets = contentsTargets(parts, units).map(({ element, level, sectionId }, i) => {
    const copy = copyOf.get(element)!
    if (level === 2) copy.id = `x-toc-${i}`
    copy.setAttribute('data-x-toc', String(level))
    return { id: level === 1 ? `x-s-${sectionId}` : copy.id, level }
  })
  // Other headings, inside the parts filled in elsewhere, are not bookmarks.
  for (const heading of Array.from(master.querySelectorAll('.dm-prose :is(h1,h2,h3,h4,h5,h6)')))
    if (!heading.hasAttribute('data-x-toc') && !heading.hasAttribute('data-x-title'))
      heading.setAttribute('role', 'none')

  master
    .querySelectorAll('.dm-cite')
    .forEach((cite) => cite.setAttribute('data-x-cite', cite.getAttribute('data-n') ?? ''))
  master.querySelectorAll(NEW_PAGE).forEach((e) => e.setAttribute('data-x-break', ''))
  master.querySelectorAll(SCREEN_READER_ONLY).forEach((e) => e.setAttribute('data-x-skip', ''))
  master.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'))

  // A table or list is cut where the page breaks; its parts share a name. A
  // table split across pages keeps the columns it had (AC7).
  let named = 0
  for (const original of Array.from(
    sheet.querySelectorAll('.dm-prose table, .dm-prose ul, .dm-prose ol'),
  )) {
    const copy = copyOf.get(original) as HTMLElement
    copy.setAttribute('data-x', `x${(named += 1)}`)
    if (!(original instanceof HTMLTableElement)) continue
    const pages = new Set(
      Array.from(copy.querySelectorAll('[data-pg-page]')).map((e) =>
        e.getAttribute('data-pg-page'),
      ),
    )
    if (pages.size < 2) continue
    const full = Array.from(original.rows).find(
      (row) => row.cells.length && Array.from(row.cells).every((cell) => cell.colSpan === 1),
    )
    if (!full) continue
    copy.style.tableLayout = 'fixed'
    copy.style.width = `${original.getBoundingClientRect().width}px`
    const colgroup = document.createElement('colgroup')
    for (const cell of Array.from(full.cells)) {
      const col = document.createElement('col')
      col.style.width = `${cell.getBoundingClientRect().width}px`
      colgroup.append(col)
    }
    copy.prepend(colgroup)
  }

  const prose = master.querySelector('.dm-prose') as HTMLElement | null
  const paper = prose?.parentElement
  if (!prose || !paper) throw new SnapshotError('The report could not be laid out in pages.')
  prose.removeAttribute('role')
  prose.removeAttribute('aria-multiline')
  prose.removeAttribute('aria-label')
  prose.removeAttribute('tabindex')

  // Where each element holding no block of the report belongs: with the
  // block before it.
  const attached = new Map<Element, number>()
  let last = -1
  const pending: Element[] = []
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_ELEMENT)
  for (
    let node = walker.nextNode() as Element | null;
    node;
    node = walker.nextNode() as Element | null
  ) {
    const page = node.getAttribute('data-pg-page')
    if (page !== null) {
      last = Number(page)
      for (const p of pending.splice(0)) attached.set(p, last)
    } else if (!node.closest('[data-pg-page]') && !node.querySelector('[data-pg-page]')) {
      if (last < 0) pending.push(node)
      else attached.set(node, last)
    }
  }
  for (const p of pending) attached.set(p, 0)

  // A block moved down to start its page loses the space that moved it.
  const unpush = (element: HTMLElement) => {
    const base = `${Number(element.getAttribute('data-pg-base')) || 0}px`
    if (element.hasAttribute('data-pg-push')) {
      const targets =
        element instanceof HTMLTableRowElement
          ? Array.from(element.cells)
          : element instanceof HTMLTableSectionElement && element.rows.length
            ? Array.from(element.rows[0].cells)
            : [element]
      for (const target of targets) target.style.paddingTop = base
      element.removeAttribute('data-pg-push')
    }
    element.querySelectorAll<HTMLElement>('[data-pg-push]').forEach((inner) => {
      inner.style.paddingTop = `${Number(inner.getAttribute('data-pg-base')) || 0}px`
      inner.removeAttribute('data-pg-push')
    })
  }

  const emittedIds = new Set<string>()
  const pageOf = (e: Element) => Number(e.getAttribute('data-pg-page'))
  function slice(element: Element, k: number): Element | null {
    if (element.hasAttribute('data-pg-page')) {
      if (pageOf(element) !== k) return null
      const copy = element.cloneNode(true) as HTMLElement
      unpush(copy)
      return copy
    }
    if (!element.querySelector('[data-pg-page]'))
      return attached.get(element) === k ? (element.cloneNode(true) as Element) : null
    const copy = element.cloneNode(false) as HTMLElement
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) copy.append(child.cloneNode())
      // A table's column widths go with each of its parts.
      else if (child instanceof HTMLTableColElement) copy.append(child.cloneNode(true))
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const part = slice(child as Element, k)
        if (part) copy.append(part)
      }
    }
    if (!copy.querySelector('[data-pg-page]')) return null
    if (copy.id) {
      if (emittedIds.has(copy.id)) copy.removeAttribute('id')
      else emittedIds.add(copy.id)
    }
    // A table carried onto this page starts with its header again (RV-12 AC8).
    if (element instanceof HTMLTableElement && element.tHead && copy instanceof HTMLTableElement) {
      const head = element.tHead
      if (head.hasAttribute('data-pg-page') && pageOf(head) < k && !copy.tHead) {
        const again = head.cloneNode(true) as HTMLElement
        unpush(again)
        again.setAttribute('data-x-repeat', '')
        again.removeAttribute('data-pg-page')
        again.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'))
        copy.insertBefore(again, copy.querySelector('tbody, tfoot'))
      }
    }
    // A numbered list carried onto this page goes on counting.
    if (element instanceof HTMLOListElement && copy instanceof HTMLOListElement) {
      const items = Array.from(element.children).filter((c) => c.tagName === 'LI')
      const pageOfItem = (li: Element) => {
        const unit = li.hasAttribute('data-pg-page') ? li : li.querySelector('[data-pg-page]')
        return unit ? pageOf(unit) : -1
      }
      const first = items.findIndex((li) => pageOfItem(li) === k)
      if (first > 0) copy.start = (element.start || 1) + first
    }
    return copy
  }

  // The front pages as they are, the contents' entries made links (AC4).
  const front = Array.from(master.children).filter((c) => c.matches('section.pg-page'))
  const kinds = ['cover', 'details']
  let entry = 0
  const frontPages = front.map((page, i) => {
    page.setAttribute('data-export-page', kinds[i] ?? 'contents')
    for (const button of Array.from(page.querySelectorAll('button.pg-toc-link'))) {
      const target = targets[entry]
      entry += 1
      const link = document.createElement('a')
      link.className = 'pg-toc-link'
      if (target) {
        link.href = `#${target.id}`
        link.setAttribute('data-x-toc', String(target.level))
      }
      link.append(...Array.from(button.childNodes))
      button.replaceWith(link)
    }
    return page.outerHTML
  })

  // Each page of the report, with the header and footer its band draws.
  const bands = Array.from(sheet.querySelectorAll('.pg-bands > div'))
  const bodyPages: string[] = []
  for (let k = 0; k < layout.pages; k += 1) {
    const page = document.createElement('section')
    page.className = 'pg-page pg-body-page'
    page.setAttribute('data-export-page', 'body')
    page.setAttribute('aria-label', `Page ${k + 1}`)
    const header = bands[k]?.querySelector('.pg-header')
    const footer = bands[k]?.querySelector('.pg-footer')
    if (header) page.append(header.cloneNode(true))
    const body = document.createElement('div')
    body.className = 'dm-body'
    const paperCopy = paper.cloneNode(false) as HTMLElement
    const proseCopy =
      (slice(prose, k) as HTMLElement | null) ?? (prose.cloneNode(false) as HTMLElement)
    paperCopy.append(proseCopy)
    body.append(paperCopy)
    page.append(body)
    if (footer) page.append(footer.cloneNode(true))
    bodyPages.push(page.outerHTML)
  }

  const sheetClass = escapeHtml(sheet.className)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${(css ?? documentCss()).replace(/<\/style/gi, '<\\/style')}</style>`,
    `<style>${EXPORT_CSS}</style>`,
    '</head>',
    '<body>',
    `<div class="${sheetClass}">`,
    ...frontPages,
    ...bodyPages,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}
