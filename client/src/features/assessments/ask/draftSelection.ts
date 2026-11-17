// Text selected in the review workspace's draft editor (AS-02), read as
// offsets in its section's text (ask/passage.ts). Each block of text the draft
// draws carries `data-ask-block`, its index in the section's text, and, where
// it shows only part of its words (a Section 6 programme row's comment),
// `data-ask-from`, where that part starts. Within a block a citation number
// counts as one character, as its marker does in the text; badges such as
// Unsupported count as none.
import type { PassageText } from './passage'

export const BLOCK_ATTR = 'data-ask-block'
const FROM_ATTR = 'data-ask-from'
// Drawn in a block but not part of its words.
const SKIP = '.rv-flag, [data-ask-skip]'
const CITE = '.rv-cite'

// The attributes a block of the draft's text is drawn with, when it is one.
export function askBlockAttrs(index: number | undefined, from = 0): Record<string, string> {
  if (index === undefined || from < 0) return {}
  return from
    ? { [BLOCK_ATTR]: String(index), [FROM_ATTR]: String(from) }
    : { [BLOCK_ATTR]: String(index) }
}

type Unit = { text: Text } | { cite: Element }

// A block's words and citation numbers, in order.
function unitsOf(block: Element): Unit[] {
  const units: Unit[] = []
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) units.push({ text: child as Text })
      else if (child instanceof Element) {
        if (child.matches(CITE)) units.push({ cite: child })
        else if (!child.matches(SKIP)) walk(child)
      }
    })
  }
  walk(block)
  return units
}

const lengthOf = (units: Unit[]) => units.reduce((n, u) => n + ('text' in u ? u.text.length : 1), 0)

// The boundary just after an element.
function after(element: Element): [Node, number] {
  const parent = element.parentNode!
  return [parent, Array.prototype.indexOf.call(parent.childNodes, element) + 1]
}

// How many of a block's characters come before a point inside it. A point
// inside a citation number is before its marker at a selection's start, after
// it at its end.
function offsetIn(block: Element, node: Node, offset: number, side: 'start' | 'end'): number {
  const point = document.createRange()
  point.setStart(node, offset)
  let count = 0
  for (const unit of unitsOf(block)) {
    if ('text' in unit) {
      if (unit.text === node) return count + Math.min(offset, unit.text.length)
      if (point.comparePoint(unit.text, unit.text.length) > 0) return count
      count += unit.text.length
    } else {
      if (unit.cite.contains(node)) return side === 'start' ? count : count + 1
      if (point.comparePoint(...after(unit.cite)) > 0) return count
      count += 1
    }
  }
  return count
}

const blocksIn = (container: Element) => Array.from(container.querySelectorAll(`[${BLOCK_ATTR}]`))

// Where a block's shown words start in the section's text, and how long they are.
function spanOf(element: Element, text: PassageText) {
  const block = text.blocks[Number(element.getAttribute(BLOCK_ATTR))]
  if (!block) return null
  const from = Number(element.getAttribute(FROM_ATTR) ?? 0)
  const shown = Math.min(lengthOf(unitsOf(element)), block.length - from)
  return { start: block.offset + from, length: Math.max(0, shown) }
}

// The section text's offsets of a selection in the draft editor, or null
// when it holds none of the section's text.
export function selectionOffsets(
  container: Element,
  range: Range,
  text: PassageText,
): { start: number; end: number } | null {
  const touched = blocksIn(container).filter((element) => range.intersectsNode(element))
  if (!touched.length) return null
  const first = touched[0]
  const last = touched[touched.length - 1]
  const a = spanOf(first, text)
  const b = spanOf(last, text)
  if (!a || !b) return null
  const start = first.contains(range.startContainer)
    ? a.start +
      Math.min(a.length, offsetIn(first, range.startContainer, range.startOffset, 'start'))
    : a.start
  const end = last.contains(range.endContainer)
    ? b.start + Math.min(b.length, offsetIn(last, range.endContainer, range.endOffset, 'end'))
    : b.start + b.length
  return start <= end ? { start, end } : { start: end, end: start }
}

// The point at a block's nth character.
function pointAt(block: Element, n: number): [Node, number] {
  let count = 0
  for (const unit of unitsOf(block)) {
    if ('text' in unit) {
      if (n <= count + unit.text.length) return [unit.text, n - count]
      count += unit.text.length
    } else {
      if (n <= count) return [unit.cite.parentNode!, after(unit.cite)[1] - 1]
      count += 1
      if (n === count) return after(unit.cite)
    }
  }
  return [block, block.childNodes.length]
}

// The draft's blocks a passage at [start, end) of the section's text is in,
// with the part of each it covers.
export function passageBlocks(container: Element, text: PassageText, start: number, end: number) {
  return blocksIn(container).flatMap((element) => {
    const span = spanOf(element, text)
    if (!span || end <= span.start || start >= span.start + span.length) return []
    const from = Math.max(0, start - span.start)
    const to = Math.min(span.length, end - span.start)
    const range = document.createRange()
    range.setStart(...pointAt(element, from))
    range.setEnd(...pointAt(element, to))
    return [{ element, range }]
  })
}
