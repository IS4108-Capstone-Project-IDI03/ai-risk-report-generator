// Marsh's page layout in the document editor (RV-12): while it is on, the
// report's blocks are measured after every change and those that would
// cross a page's foot are moved to the next page (paginate.ts), so the
// engineer keeps writing in the same editor and sees the pages reflow (AC6).
// The space above a moved ProseMirror block is a node decoration; a block
// drawn by React inside a locked part is moved by its own style (measure.ts).
// What the layout works out (pages, where each one's text ends, repeated
// table headers, the page each heading starts on) goes to onLayout, which
// draws the pages around the text (PageFrame.tsx).
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { MARSH_GEOMETRY, snap, type PageGeometry } from './geometry'
import {
  applyPartPushes,
  clearPush,
  headerCopy,
  measureUnits,
  PUSH_ATTRIBUTE,
  type Measurement,
  type UnitHeading,
} from './measure'
import { paginate, type Pagination } from './paginate'

// A table header repeated at the top of a page: where, and a copy to draw.
export type RepeatedHeaderView = {
  top: number
  height: number
  left: number
  width: number
  html: string
}

export type PageLayoutState = {
  pages: number
  // Where the text ends on each page, from the first page's top edge.
  ends: number[]
  repeats: (RepeatedHeaderView | null)[]
  // Each heading the contents can list, with the page it starts on (from 0).
  headings: (UnitHeading & { page: number })[]
  // How many blocks are taller than a page and run past one.
  overflows: number
  // Screen pixels per layout pixel.
  scale: number
  // False where nothing could be measured: the pages are then counted with
  // each section on a page of its own.
  measured: boolean
}

type Push = { push: number; base: number }
type LayoutPluginState = { enabled: boolean; decorations: DecorationSet }
type LayoutMeta = { enabled: boolean } | { pushes: Map<number, Push> }

export const pageLayoutKey = new PluginKey<LayoutPluginState>('dmPageLayout')

// Turns the page layout on or off; off, every moved block goes back.
export function setPageLayout(editor: Editor, enabled: boolean) {
  const meta: LayoutMeta = { enabled }
  editor.view.dispatch(editor.state.tr.setMeta(pageLayoutKey, meta).setMeta('addToHistory', false))
}

function decorationsFor(doc: PMNode, pushes: Map<number, Push>) {
  const decorations: Decoration[] = []
  for (const [pos, { push, base }] of pushes) {
    const node = doc.nodeAt(pos)
    if (!node) continue
    decorations.push(
      Decoration.node(
        pos,
        pos + node.nodeSize,
        { style: `padding-top: ${snap(base + push)}px`, [PUSH_ATTRIBUTE]: String(push) },
        { push, base },
      ),
    )
  }
  return DecorationSet.create(doc, decorations)
}

// The space each ProseMirror block has now, by position.
function pushesOf(set: DecorationSet): Map<number, Push> {
  return new Map(set.find().map((d) => [d.from, d.spec as Push]))
}

function samePushes(a: Map<number, Push>, b: Map<number, Push>) {
  if (a.size !== b.size) return false
  for (const [pos, p] of a) {
    const q = b.get(pos)
    if (!q || Math.abs(q.push - p.push) >= 0.01 || Math.abs(q.base - p.base) >= 0.01) return false
  }
  return true
}

const half = (n: number) => Math.round(n * 2) / 2

// What the pages around the text need to know of a layout.
export function layoutStateOf(measurement: Measurement, result: Pagination): PageLayoutState {
  const { units, measurable, scale } = measurement
  return {
    pages: result.pages,
    ends: result.ends.map(half),
    repeats: result.repeats.map((repeat) => {
      if (!repeat || !measurable) return null
      const head = units.find((u) => u.table === repeat.table && u.header)
      if (!(head?.element instanceof HTMLTableSectionElement)) return null
      const copy = headerCopy(head.element, measurement)
      return { top: half(repeat.top), height: half(repeat.height), ...copy }
    }),
    headings: units.flatMap((u, i) =>
      u.heading ? [{ ...u.heading, page: result.pageOf[i] }] : [],
    ),
    overflows: result.overflows.length,
    scale,
    measured: measurable,
  }
}

// Moving blocks changes nothing else, so a layout settles on its second
// pass; past this many passes in a row something keeps moving, and the
// layout stops moving blocks until the text changes.
const MAX_PASSES = 4

const nextFrame = (run: () => void) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : (setTimeout(run, 16) as unknown as number)
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)

class LayoutView {
  view: EditorView
  options: PageLayoutOptions
  frame = 0
  passes = 0
  last = ''
  styled = new Set<HTMLElement>()
  observer: ResizeObserver | null = null
  running = false

  constructor(view: EditorView, options: PageLayoutOptions) {
    this.view = view
    this.options = options
    this.update(view, null)
  }

  // An image loading, or the fonts, changes heights without a transaction.
  relayout = () => this.schedule()

  update(view: EditorView, previous: EditorView['state'] | null) {
    this.view = view
    const now = pageLayoutKey.getState(view.state)
    const before = previous ? pageLayoutKey.getState(previous) : null
    if (!now?.enabled) {
      if (this.running) this.stop()
      return
    }
    if (!this.running) this.start()
    if (!before?.enabled || (previous && previous.doc !== view.state.doc)) this.passes = 0
    this.schedule()
  }

  start() {
    this.running = true
    const root = this.view.dom as HTMLElement
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.relayout)
      this.observer.observe(root)
    }
    root.addEventListener('load', this.relayout, true)
    void document.fonts?.ready.then(this.relayout)
  }

  stop() {
    this.running = false
    if (this.frame) cancelFrame(this.frame)
    this.frame = 0
    this.observer?.disconnect()
    this.observer = null
    ;(this.view.dom as HTMLElement).removeEventListener('load', this.relayout, true)
    for (const element of this.styled) clearPush(element)
    this.styled.clear()
    this.last = ''
    this.options.onLayout(null)
  }

  schedule() {
    if (this.frame || !this.running) return
    this.frame = nextFrame(() => {
      this.frame = 0
      this.run()
    })
  }

  run() {
    const state = pageLayoutKey.getState(this.view.state)
    if (!state?.enabled || this.view.isDestroyed) return
    const measurement = measureUnits(this.view)
    const result = paginate(measurement.units, this.options.geometry)
    if (measurement.measurable && this.passes < MAX_PASSES) {
      const moved = applyPartPushes(measurement.units, result.pushes, this.styled)
      const pushes = new Map<number, Push>()
      measurement.units.forEach((unit, i) => {
        const push = snap(result.pushes[i])
        if (unit.pos !== null && push > 0) pushes.set(unit.pos, { push, base: unit.basePadding })
      })
      const changed = !samePushes(pushes, pushesOf(state.decorations))
      if (changed) {
        const meta: LayoutMeta = { pushes }
        this.view.dispatch(
          this.view.state.tr.setMeta(pageLayoutKey, meta).setMeta('addToHistory', false),
        )
      }
      // Measured again once moved, to check it settled.
      if (moved || changed) {
        this.passes += 1
        this.schedule()
      } else this.passes = 0
    }
    const layout = layoutStateOf(measurement, result)
    const key = JSON.stringify(layout)
    if (key !== this.last) {
      this.last = key
      this.options.onLayout(layout)
    }
  }

  destroy() {
    if (this.running) this.stop()
  }
}

export type PageLayoutOptions = {
  geometry: PageGeometry
  // Told each new layout, and null when the page layout is turned off.
  onLayout: (layout: PageLayoutState | null) => void
}

export const PageLayout = Extension.create<PageLayoutOptions>({
  name: 'pageLayout',
  addOptions: () => ({ geometry: MARSH_GEOMETRY, onLayout: () => {} }),
  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<LayoutPluginState>({
        key: pageLayoutKey,
        state: {
          init: () => ({ enabled: false, decorations: DecorationSet.empty }),
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(pageLayoutKey) as LayoutMeta | undefined
            if (meta && 'enabled' in meta)
              return { enabled: meta.enabled, decorations: DecorationSet.empty }
            if (meta && 'pushes' in meta)
              return value.enabled
                ? { ...value, decorations: decorationsFor(state.doc, meta.pushes) }
                : value
            return tr.docChanged
              ? { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) }
              : value
          },
        },
        props: { decorations: (state) => pageLayoutKey.getState(state)?.decorations },
        view: (view) => new LayoutView(view, options),
      }),
    ]
  },
})
