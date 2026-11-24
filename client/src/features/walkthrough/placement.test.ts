// Where the highlight and bubble go (F-12): clipping to the window, the bubble beside the visible
// part, whole rows beside a phone sheet, and bringing a target into view on both axes.
import { describe, expect, it, vi } from 'vitest'
import {
  apartBoxes,
  betweenLines,
  bringIntoView,
  clipBox,
  cutTo,
  pinnedCut,
  placeBubble,
  roomFor,
  wholeRowsFrom,
  wholeRowsTo,
} from './placement'

const WIN = { w: 1440, h: 900 }
const BUBBLE = { w: 412, h: 160 }

describe('clipBox', () => {
  it('leaves a box inside the window alone', () => {
    expect(clipBox({ x: 100, y: 100, w: 200, h: 40 }, WIN)).toEqual({
      x: 100,
      y: 100,
      w: 200,
      h: 40,
    })
  })

  it('clips a box wider or taller than the window, so 6 px of dimming frames the cut-out', () => {
    // A wide table on a phone, and a union of cards taller than the window.
    expect(clipBox({ x: -300, y: 200, w: 1200, h: 100 }, { w: 375, h: 812 })).toEqual({
      x: 12,
      y: 200,
      w: 351,
      h: 100,
    })
    expect(clipBox({ x: 300, y: 40, w: 400, h: 2000 }, WIN)).toEqual({
      x: 300,
      y: 40,
      w: 400,
      h: 848,
    })
  })
})

describe('placeBubble', () => {
  it('sits 16 px to the right of the cut-out when there is room', () => {
    expect(placeBubble('target', { x: 100, y: 200, w: 100, h: 40 }, BUBBLE, WIN)).toEqual({
      left: 222,
      top: 194,
    })
  })

  it('beside the visible part of a union taller than the window, never over it', () => {
    const tall = clipBox({ x: 300, y: -200, w: 400, h: 2000 }, WIN)
    expect(placeBubble('target', tall, BUBBLE, WIN)).toEqual({ left: 722, top: 16 })
  })
})

describe('roomFor', () => {
  it('keeps the whole highlight when the bubble fits beside it', () => {
    const box = { x: 100, y: 200, w: 100, h: 40 }
    expect(roomFor(box, BUBBLE, WIN)).toBe(box)
  })

  it('draws only the top of a window-filling grid, with the bubble below it, never over it', () => {
    const grid = clipBox({ x: 240, y: 120, w: 1180, h: 933 }, WIN)
    const part = roomFor(grid, BUBBLE, WIN)
    const spot = placeBubble('target', part, BUBBLE, WIN) as { left: number; top: number }
    expect(spot.top).toBeGreaterThanOrEqual(part.y + part.h + 6 + 16)
    expect(spot.top + BUBBLE.h).toBeLessThanOrEqual(WIN.h - 16)
  })

  // Client insights step 3: three panels lit one by one, their union too big for the bubble anywhere.
  it('cuts each separate cut-out to the drawn part, so the bubble sits over none of them', () => {
    const panels = [
      { x: 948, y: 10, w: 466, h: 570 },
      { x: 250, y: 586, w: 659, h: 380 },
      { x: 913, y: 586, w: 501, h: 380 },
    ]
    const union = clipBox({ x: 250, y: 10, w: 1164, h: 956 }, WIN)
    const part = roomFor(union, BUBBLE, WIN)
    const spot = placeBubble('target', part, BUBBLE, WIN) as { left: number; top: number }
    const bubble = { x: spot.left, y: spot.top, w: BUBBLE.w, h: BUBBLE.h }
    const holes = cutTo(panels, part)
    expect(holes).toHaveLength(3)
    for (const h of holes) expect(h.y + h.h + 6).toBeLessThanOrEqual(bubble.y)
    expect(cutTo([{ x: 0, y: 800, w: 10, h: 10 }], part)).toEqual([])
  })
})

describe('apartBoxes', () => {
  it('keeps boxes that are apart, and joins two whose cut-outs would touch', () => {
    const comment = { x: 100, y: 100, w: 32, h: 32 }
    const ask = { x: 240, y: 100, w: 32, h: 32 }
    const rewrite = { x: 276, y: 100, w: 32, h: 32 } // 4 px from Ask: their cut-outs overlap
    expect(apartBoxes([comment, ask, rewrite])).toEqual([comment, { x: 240, y: 100, w: 68, h: 32 }])
  })
})

describe('bringIntoView', () => {
  // A target inside `box`, with jsdom's missing layout filled in by hand.
  function setUp(
    overflow: string,
    rect: DOMRect,
    size = { sw: 2000, sh: 3000 },
    at = new DOMRect(0, 0, 4000, 4000),
  ) {
    const box = document.createElement('div')
    // jsdom does not split the `overflow` shorthand, so both axes are set.
    box.style.overflowX = overflow
    box.style.overflowY = overflow
    Object.defineProperties(box, {
      scrollWidth: { value: size.sw },
      clientWidth: { value: 375 },
      scrollHeight: { value: size.sh },
      clientHeight: { value: 800 },
    })
    box.scrollBy = vi.fn()
    // Fills the window unless a test gives it its own place (a panel's body under its header).
    box.getBoundingClientRect = () => at
    const target = document.createElement('button')
    target.getBoundingClientRect = () => rect
    box.append(target)
    document.body.append(box)
    return { box, target }
  }

  it('scrolls its own scroll container to bring a tab cut off sideways to the inline centre', () => {
    const { box, target } = setUp('auto', new DOMRect(400, 120, 80, 40))
    bringIntoView([target], { w: 375, h: 812 })
    expect(box.scrollBy).toHaveBeenCalledWith({ left: 440 - 187.5 })
    box.remove()
  })

  it('never scrolls an overflow: hidden box (the app shell), on either axis', () => {
    const { box, target } = setUp('hidden', new DOMRect(400, 1200, 80, 40))
    bringIntoView([target], { w: 375, h: 812 })
    expect(box.scrollBy).not.toHaveBeenCalled()
    box.remove()
  })

  it('scrolls a union taller than the window to its top', () => {
    const { box, target } = setUp('auto', new DOMRect(20, -400, 300, 1600))
    bringIntoView([target], WIN)
    expect(box.scrollBy).toHaveBeenCalledWith({ top: -416 })
    box.remove()
  })

  it('measures against the scroller’s own box: a tall union’s top lands under a panel’s header, not behind it', () => {
    // The panel's body shows y 200 to 800; the union starts at 500 and is taller than the body.
    const { box, target } = setUp(
      'auto',
      new DOMRect(900, 500, 400, 900),
      undefined,
      new DOMRect(880, 200, 440, 600),
    )
    bringIntoView([target], WIN)
    expect(box.scrollBy).toHaveBeenCalledWith({ top: 500 - 200 - 16 })
    box.remove()
  })

  it('shows the end of a tall union when the step asks for it', () => {
    const { box, target } = setUp('auto', new DOMRect(20, 100, 300, 1600))
    bringIntoView([target], WIN, true)
    expect(box.scrollBy).toHaveBeenCalledWith({ top: 1700 - 900 + 16 })
    box.remove()
  })

  it('leaves a table wider than its box at its start', () => {
    const { box, target } = setUp('auto', new DOMRect(20, 100, 900, 40))
    bringIntoView([target], { w: 375, h: 812 })
    expect(box.scrollBy).not.toHaveBeenCalled()
    box.remove()
  })

  it('counts the cut-out padding: a button 5 px from the bottom edge is scrolled up', () => {
    const { box, target } = setUp('auto', new DOMRect(20, 855, 100, 40))
    bringIntoView([target], WIN)
    expect(box.scrollBy).toHaveBeenCalledWith({ top: 875 - 450 })
    box.remove()
  })

  it('leaves a target already in view alone', () => {
    const { box, target } = setUp('auto', new DOMRect(20, 100, 80, 40))
    bringIntoView([target], WIN)
    expect(box.scrollBy).not.toHaveBeenCalled()
    box.remove()
  })
})

describe('wholeRowsTo', () => {
  // A list 1000 px tall from y 100 (heading 40 px, rows 60 px each), with the sheet's top at 500.
  it('stops the cut-out at the last whole row above the limit, never through one', () => {
    const list = document.createElement('div')
    const at = (el: HTMLElement, top: number, h: number, w = 300) =>
      (el.getBoundingClientRect = () => new DOMRect(0, top, w, h))
    at(list, 100, 1000)
    const heading = document.createElement('h2')
    at(heading, 100, 40)
    list.append(heading)
    for (let i = 0; i < 15; i++) {
      const row = document.createElement('div')
      at(row, 140 + i * 60, 60)
      list.append(row)
    }
    const icon = document.createElement('span')
    at(icon, 380, 100, 20) // narrow: not a row
    list.append(icon)
    expect(wholeRowsTo([list], { x: 0, y: 100, w: 300, h: 1000 }, 494)).toBe(440 - 100) // the row ending at 440; the next ends at 500, under the sheet
  })
})

describe('rows are never cut inside', () => {
  // A list from y 100: a 40 px heading, then 100 px cards (each with two 40 px lines inside), 10 px apart.
  const list = () => {
    const el = document.createElement('div')
    const at = (node: HTMLElement, top: number, h: number, w = 300) =>
      (node.getBoundingClientRect = () => new DOMRect(0, top, w, h))
    at(el, 100, 600)
    const heading = document.createElement('h2')
    at(heading, 100, 40)
    el.append(heading)
    for (let i = 0; i < 4; i++) {
      const card = document.createElement('div')
      const top = 150 + i * 110
      at(card, top, 100)
      for (const dy of [10, 50]) {
        const line = document.createElement('p')
        at(line, top + dy, 40)
        card.append(line)
      }
      el.append(card)
    }
    return el
  }
  const BOX = { x: 0, y: 100, w: 300, h: 600 }

  it('stops above a card the limit crosses, not at a line inside it', () => {
    // The limit (330) falls inside the second card (260 to 360), after its first line (270 to 310).
    expect(wholeRowsTo([list()], BOX, 330)).toBe(250 - 100)
  })

  it('stops at what the target’s scroller shows, never past it (the Ask composer below)', () => {
    expect(wholeRowsTo([list()], { ...BOX, h: 300 }, 700)).toBe(360 - 100) // the box ends at 400
  })

  it('starts below a card the limit crosses, at the next whole card', () => {
    expect(wholeRowsFrom([list()], BOX, 200)).toBe(260) // the first card (150 to 250) is cut by 200
  })
})

describe('wholeRowsFrom', () => {
  // A panel from y 100 to 760 (rows 60 px each from 140), shown from its end under a sheet ending at 226.
  it('starts the cut-out at the first whole row under the sheet, never through one', () => {
    const panel = document.createElement('div')
    const at = (el: HTMLElement, top: number, h: number) =>
      (el.getBoundingClientRect = () => new DOMRect(0, top, 300, h))
    at(panel, 100, 660)
    for (let i = 0; i < 10; i++) {
      const row = document.createElement('div')
      at(row, 140 + i * 60, 60)
      panel.append(row)
    }
    expect(wholeRowsFrom([panel], { x: 0, y: 100, w: 300, h: 660 }, 240)).toBe(260) // 200 starts above it
  })
})

describe('betweenLines', () => {
  // A sheet from y 500: three lines ending at 540, 562 and 584, a 58 px foot and 16 px of padding under it.
  it('cuts a capped sheet after the last whole line that fits, never through one', () => {
    const sheet = document.createElement('div')
    sheet.innerHTML = '<div class="wt-text">words</div><div class="wt-foot"></div>'
    sheet.style.paddingBottom = '16px'
    sheet.getBoundingClientRect = () => new DOMRect(0, 500, 375, 300)
    sheet.querySelector('.wt-foot')!.getBoundingClientRect = () => new DOMRect(0, 0, 375, 58)
    document.body.append(sheet)
    const lines = [540, 562, 584].map((bottom) => new DOMRect(16, bottom - 20, 300, 20))
    // jsdom lays nothing out, so Range has no getClientRects of its own.
    Range.prototype.getClientRects = () => lines as unknown as DOMRectList
    // Line ends plus the foot and padding (74): 114, 136, 158.
    expect(betweenLines(sheet, 150)).toBe(136)
    expect(betweenLines(sheet, 200)).toBe(158)
    Reflect.deleteProperty(Range.prototype, 'getClientRects')
    sheet.remove()
  })
})

describe('pinnedCut', () => {
  // The Ask answer scrolls under the panel's pinned question box: the lit part stops above it.
  it('stops a target’s lit part above a pinned bar over its bottom, and leaves an uncovered one alone', () => {
    const target = document.body.appendChild(document.createElement('div'))
    const bar = document.body.appendChild(document.createElement('div'))
    bar.style.position = 'sticky'
    bar.getBoundingClientRect = () => ({ top: 700, bottom: 900 }) as DOMRect
    const at = vi.fn((_x: number, y: number) => (y > 700 ? [bar] : [target]))
    document.elementsFromPoint = at
    expect(pinnedCut(target, { left: 0, right: 300 }, 180, 895, WIN)).toEqual([180, 700])
    expect(pinnedCut(target, { left: 0, right: 300 }, 180, 650, WIN)).toEqual([180, 650])
    target.remove()
    bar.remove()
  })
})
