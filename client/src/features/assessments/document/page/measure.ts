// The report's blocks as the page layout measures them (RV-12): where each
// sits with no page breaks, and the space that moves a block to the next page.
// A block of the report's text is a ProseMirror node, moved by a decoration
// (PageLayout.ts) so the editor keeps control of its DOM. A part filled in
// elsewhere (a locked block, drawn by React) is walked inside: its tables row
// by row, its charts, legends, matrix and photos whole; those are moved by
// their own style, which ProseMirror ignores inside a locked block.
import type { EditorView } from '@tiptap/pm/view'
import { snap } from './geometry'
import type { LayoutUnit } from './paginate'

// Never split across a page (AC8): a chart, the Risk Assessment Matrix, the
// Rating Legend, a photo, and charts set side by side.
const WHOLE = 'figure, img, svg, canvas, .rv-ram-table, .rv-legend, .rv-charts-grid'
// Kept on one page when it fits on one (AC8): an OFI record.
const KEPT_TOGETHER = '.rv-ofi-table'
// Starts a page (AC8): each Section 5 loss level, as Marsh's template has it.
const NEW_PAGE = '.rv-figures-level'
// The report's own structure: walked into, never a block itself.
const PM_CONTAINERS = new Set(['reportSection', 'subsection', 'bulletList', 'orderedList'])

// Set on an element moved down by the layout, with the space in pixels.
export const PUSH_ATTRIBUTE = 'data-pg-push'

// A heading the contents can list: a section's (level 1), or one level down,
// a template subsection's or the engineer's own sub-heading written in the
// section's opening text (level 2).
export type UnitHeading = { sectionId: string; level: 1 | 2; text: string }

export type MeasuredUnit = LayoutUnit & {
  element: HTMLElement
  // The ProseMirror node it is, moved by a decoration; null for a part drawn
  // by React inside a locked block, moved by its own style.
  pos: number | null
  // A table header or row is moved by its cells' padding.
  cells: HTMLElement[] | null
  // Its padding above any space the layout adds, to keep when moving it.
  basePadding: number
  heading: UnitHeading | null
}

export type Measurement = {
  units: MeasuredUnit[]
  // False where nothing is laid out (jsdom, or the editor hidden): the units
  // are listed in order, all at 0, and nothing is moved.
  measurable: boolean
  // Screen pixels per layout pixel, for a page shown scaled.
  scale: number
  rootRect: DOMRect
}

const pushOf = (element: Element) => Number(element.getAttribute(PUSH_ATTRIBUTE)) || 0
const paddingTop = (element: Element) => parseFloat(getComputedStyle(element).paddingTop) || 0

// Whether an element is drawn at all (not display: none).
const shown = (element: Element) => element.getClientRects().length > 0

// Whether an element's children sit one under the other, so a page can
// start between them; otherwise it is one block (inline content, columns).
function stacked(element: HTMLElement): boolean {
  for (const node of element.childNodes)
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false
  const children = [...element.children].filter(shown) as HTMLElement[]
  if (!children.length) return false
  let bottom = -Infinity
  for (const child of children) {
    const style = getComputedStyle(child)
    if (style.display.startsWith('inline') || style.float !== 'none') return false
    if (style.position === 'absolute' || style.position === 'fixed') continue
    const rect = child.getBoundingClientRect()
    if (rect.top < bottom - 1) return false
    bottom = Math.max(bottom, rect.bottom)
  }
  return true
}

export function measureUnits(view: EditorView): Measurement {
  const root = view.dom as HTMLElement
  const rootRect = root.getBoundingClientRect()
  const measurable = rootRect.height > 0 && rootRect.width > 0
  // offsetWidth is whole pixels, so only a real zoom counts as a scale.
  const ratio = measurable && root.offsetWidth ? rootRect.width / root.offsetWidth : 1
  const scale = Math.abs(ratio - 1) < 0.02 ? 1 : ratio
  const { doc } = view.state

  // Each node's DOM, to know a ProseMirror block when the walk meets it.
  const positions = new Map<Node, number>()
  doc.descendants((node, pos) => {
    const dom = view.nodeDOM(pos)
    if (dom) positions.set(dom, pos)
    return PM_CONTAINERS.has(node.type.name)
  })

  const units: MeasuredUnit[] = []
  // Space already added above the blocks measured so far.
  let moved = 0
  // Rules for the next block: set by a section or loss level it opens.
  let breakNext = false
  let tables = 0

  const add = (
    element: HTMLElement,
    pos: number | null,
    rules: Partial<LayoutUnit> & { cells?: HTMLElement[]; heading?: UnitHeading | null } = {},
  ) => {
    const { cells = null, heading = null, ...layout } = rules
    const pushed = pushOf(element)
    const padded = cells?.[0] ?? element
    let top = 0
    let bottom = 0
    if (measurable) {
      const rect = element.getBoundingClientRect()
      top = (rect.top - rootRect.top) / scale - moved
      moved += pushed
      bottom = (rect.bottom - rootRect.top) / scale - moved
    }
    units.push({
      ...layout,
      top,
      bottom: Math.max(top, bottom),
      breakBefore: breakNext || layout.breakBefore,
      element,
      pos,
      cells,
      basePadding: measurable ? Math.max(0, paddingTop(padded) - pushed) : 0,
      heading,
    })
    breakNext = false
  }

  const isShown = (element: Element) => !measurable || shown(element)

  // A table: its header and rows, the header repeated over a page it
  // continues on, an OFI record's kept together when it fits (AC8).
  const walkTable = (table: HTMLTableElement) => {
    const id = `table-${(tables += 1)}`
    const group = table.matches(KEPT_TOGETHER) ? id : undefined
    if (table.caption && isShown(table.caption))
      add(table.caption, null, { keepWithNext: true, group })
    const head = table.tHead
    if (head && isShown(head) && head.rows.length)
      add(head, null, {
        table: id,
        header: true,
        keepWithNext: true,
        group,
        cells: [...head.rows[0].cells],
      })
    const rows = [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])].flatMap((body) => [
      ...body.rows,
    ])
    for (const row of rows)
      if (isShown(row)) add(row, null, { table: id, group, cells: [...row.cells] })
  }

  // Inside a locked block: what React drew.
  const walkPart = (element: HTMLElement) => {
    for (const child of [...element.children] as HTMLElement[]) {
      if (!isShown(child)) continue
      if (child.matches(NEW_PAGE)) breakNext = true
      if (child instanceof HTMLTableElement && !child.matches(WHOLE)) walkTable(child)
      else if (/^H[1-6]$/.test(child.tagName)) add(child, null, { keepWithNext: true })
      else if (child.matches(WHOLE) || (measurable ? !stacked(child) : !child.children.length))
        add(child, null)
      else walkPart(child)
    }
  }

  // The report's own nodes, section by section.
  const walk = (element: HTMLElement, sectionId: string, inSubsection: boolean) => {
    for (const child of [...element.children] as HTMLElement[]) {
      const pos = positions.get(child)
      if (pos === undefined || !isShown(child)) continue
      const node = doc.nodeAt(pos)
      if (!node) continue
      const name = node.type.name
      if (name === 'reportSection') {
        // Each section starts a page, as in Marsh's reports.
        breakNext = true
        walk(child, node.attrs.id as string, false)
      } else if (PM_CONTAINERS.has(name))
        walk(child, sectionId, inSubsection || name === 'subsection')
      else if (name === 'lockedBlock') walkPart(child)
      else if (name === 'sectionHeading')
        add(child, pos, {
          keepWithNext: true,
          heading: { sectionId, level: 1, text: node.attrs.label as string },
        })
      else if (name === 'subsectionHeading')
        add(child, pos, {
          keepWithNext: true,
          heading: { sectionId, level: 2, text: node.attrs.label as string },
        })
      else if (name === 'heading') {
        const text = node.textContent.trim()
        add(child, pos, {
          keepWithNext: true,
          heading: !inSubsection && text ? { sectionId, level: 2, text } : null,
        })
      } else add(child, pos)
    }
  }

  walk(root, '', false)
  return { units, measurable, scale, rootRect }
}

// Padding set by the layout, to undo: each element's own inline value first.
const ORIGINAL = new WeakMap<HTMLElement, string>()

function setPadding(target: HTMLElement, value: string | null) {
  if (!ORIGINAL.has(target)) ORIGINAL.set(target, target.style.paddingTop)
  target.style.paddingTop = value ?? ORIGINAL.get(target)!
}

// Moves the blocks React drew by their own padding, and puts back any moved
// before that no longer needs to be. Returns whether anything changed.
export function applyPartPushes(
  units: MeasuredUnit[],
  pushes: number[],
  styled: Set<HTMLElement>,
): boolean {
  let changed = false
  const now = new Set<HTMLElement>()
  units.forEach((unit, i) => {
    if (unit.pos !== null) return
    const push = snap(pushes[i])
    if (push <= 0) return
    now.add(unit.element)
    if (Math.abs(pushOf(unit.element) - push) < 0.01) return
    changed = true
    for (const target of unit.cells ?? [unit.element])
      setPadding(target, `${unit.basePadding + push}px`)
    unit.element.setAttribute(PUSH_ATTRIBUTE, String(push))
  })
  for (const element of styled)
    if (!now.has(element)) {
      changed = true
      clearPush(element)
    }
  styled.clear()
  for (const element of now) styled.add(element)
  return changed
}

// Puts an element moved by its own style back where it was.
export function clearPush(element: HTMLElement) {
  const cells =
    element instanceof HTMLTableRowElement
      ? [...element.cells]
      : element instanceof HTMLTableSectionElement && element.rows.length
        ? [...element.rows[0].cells]
        : [element]
  for (const target of cells) if (ORIGINAL.has(target)) setPadding(target, null)
  element.removeAttribute(PUSH_ATTRIBUTE)
}

// A copy of a table's header to repeat over a page it continues on (AC8),
// with the table's width and column widths, and none of the layout's space.
export function headerCopy(head: HTMLTableSectionElement, measurement: Measurement) {
  const table = head.closest('table')!
  const { rootRect, scale } = measurement
  const rect = table.getBoundingClientRect()
  const copy = table.cloneNode(false) as HTMLTableElement
  copy.removeAttribute('aria-label')
  copy.removeAttribute('aria-labelledby')
  copy.setAttribute('aria-hidden', 'true')
  copy.style.width = `${rect.width / scale}px`
  copy.style.minWidth = '0'
  copy.style.tableLayout = 'fixed'
  copy.style.margin = '0'
  // Column widths from the first row with one cell per column.
  const widths = [...table.rows].find(
    (row) => row.cells.length && [...row.cells].every((cell) => cell.colSpan === 1),
  )
  if (widths) {
    const colgroup = document.createElement('colgroup')
    for (const cell of widths.cells) {
      const col = document.createElement('col')
      col.style.width = `${cell.getBoundingClientRect().width / scale}px`
      colgroup.append(col)
    }
    copy.append(colgroup)
  }
  const headCopy = head.cloneNode(true) as HTMLTableSectionElement
  headCopy.removeAttribute(PUSH_ATTRIBUTE)
  const originals = [...head.querySelectorAll<HTMLElement>('th, td')]
  headCopy.querySelectorAll<HTMLElement>('th, td').forEach((cell, i) => {
    if (ORIGINAL.has(originals[i])) cell.style.paddingTop = ORIGINAL.get(originals[i])!
  })
  headCopy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  copy.append(headCopy)
  return {
    left: (rect.left - rootRect.left) / scale,
    width: rect.width / scale,
    html: copy.outerHTML,
  }
}

// The nearest ancestor that scrolls, or the page.
export function scrollParent(element: HTMLElement): HTMLElement {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight)
      return at
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

// What the engineer is looking at: the document position at the top of the
// visible part of the editor, and how far below that top it is drawn.
export type Place = { pos: number; offset: number }

const visibleTopOf = (scroller: HTMLElement, floor: number) =>
  Math.max(floor, scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top)

// `floor`: the bottom of anything fixed over the top of the view (the save
// bar and toolbar), in screen pixels.
export function placeOf(view: EditorView, floor = 0): Place | null {
  const root = view.dom as HTMLElement
  const rootRect = root.getBoundingClientRect()
  if (!rootRect.height) return null
  const top = visibleTopOf(scrollParent(root), floor)
  const probe = Math.max(top + 4, rootRect.top + 1)
  const found = view.posAtCoords({ left: rootRect.left + rootRect.width / 2, top: probe })
  const pos = found?.pos ?? (probe <= rootRect.top + 1 ? 1 : null)
  if (pos === null) return null
  try {
    return { pos, offset: view.coordsAtPos(pos).top - top }
  } catch {
    return null
  }
}

// Scrolls the editor so the position is drawn where it was (AC1).
export function restorePlace(view: EditorView, place: Place, floor = 0) {
  const scroller = scrollParent(view.dom as HTMLElement)
  const top = visibleTopOf(scroller, floor)
  let at: number
  try {
    at = view.coordsAtPos(Math.min(place.pos, view.state.doc.content.size)).top
  } catch {
    return
  }
  const delta = at - top - place.offset
  if (Math.abs(delta) < 1) return
  if (scroller === document.scrollingElement) window.scrollBy(0, delta)
  else scroller.scrollTop += delta
}

// Scrolls so a page of the report starts at the top of the view.
export function scrollToPage(view: EditorView, top: number, scale: number, floor = 0) {
  const root = view.dom as HTMLElement
  const body = root.closest('.dm-body') as HTMLElement | null
  if (!body) return
  const scroller = scrollParent(root)
  const delta = body.getBoundingClientRect().top + top * scale - visibleTopOf(scroller, floor)
  if (scroller === document.scrollingElement) window.scrollBy(0, delta)
  else scroller.scrollTop += delta
}
