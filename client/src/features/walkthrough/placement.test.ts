// Where the highlight and bubble go (F-12): clipping to the window, the bubble beside the visible
// part, the phone sheet's side, and bringing a target into view on both axes.
import { describe, expect, it, vi } from 'vitest'
import { apartBoxes, bringIntoView, clipBox, placeBubble, roomFor, sheetSide } from './placement'

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
})

describe('sheetSide', () => {
  it('docks at the bottom when the highlight is above the sheet, else at the top', () => {
    expect(sheetSide({ x: 16, y: 100, w: 200, h: 44 }, 200, 812)).toBe('bottom')
    // A composer button pinned to the bottom edge.
    expect(sheetSide({ x: 300, y: 760, w: 44, h: 44 }, 200, 812)).toBe('top')
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
