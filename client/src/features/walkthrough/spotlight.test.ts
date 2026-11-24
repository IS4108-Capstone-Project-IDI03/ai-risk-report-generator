// The spotlight adapter (F-12): what it asks driver.js to draw for a tell step, a hands-on step, a
// card, an apart step, a step inside a dialog, and at the end. driver.js is stubbed (jsdom lays nothing out).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hideSpot, showSpot, type Spot } from './spotlight'

const fake = vi.hoisted(() => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  return {
    svg,
    make: vi.fn(),
    highlight: vi.fn(),
    setConfig: vi.fn(),
    refresh: vi.fn(),
    destroy: vi.fn(),
    getState: vi.fn((key: string) => (key === '__overlaySvg' ? svg : undefined)),
  }
})
vi.mock('driver.js', () => ({
  driver: (config: unknown) => (fake.make(config), fake),
}))

const BOX = { x: 100, y: 100, w: 120, h: 40 }
const OTHER = { x: 400, y: 100, w: 60, h: 40 }
// BOX's cut-out (6 px round it, radius 10) as an SVG sub-path, worked out by hand.
const BOX_HOLE =
  'M104 94H216A10 10 0 0 1 226 104V136A10 10 0 0 1 216 146H104A10 10 0 0 1 94 136V104A10 10 0 0 1 104 94Z'
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const path = () => fake.svg.firstElementChild!

let host: HTMLElement
const spot = (over: Partial<Spot>): Spot => ({
  key: 't.button',
  box: BOX,
  holes: null,
  open: [],
  host,
  calm: false,
  ...over,
})
const lit = () => fake.highlight.mock.calls.at(-1)![0].element as HTMLElement | undefined
const block = () => host.querySelector<HTMLElement>('.wt-block')

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  path().setAttribute('d', 'M0 0H800V600H0Z')
  fake.svg.removeAttribute('data-leaving')
})
afterEach(async () => {
  hideSpot()
  await pause(160)
  host.remove()
})

describe('what driver.js is asked to draw', () => {
  it('a tell step: the dimming and one cut-out round a stand-in at the box; the whole page blocked', () => {
    showSpot(spot({}))
    expect(fake.make).toHaveBeenCalledWith(
      expect.objectContaining({
        overlayColor: 'var(--scrim)',
        stagePadding: 6,
        stageRadius: 10,
        allowPageInteraction: true,
        allowKeyboardControl: false,
        allowClose: false,
      }),
    )
    expect(lit()!.style.left).toBe('100px')
    expect(lit()!.style.width).toBe('120px')
    expect(lit()!.style.pointerEvents).toBe('none')
    expect(block()!.style.clipPath).toBe('')
  })

  it('a hands-on step: presses reach only the cut-out', () => {
    showSpot(spot({ open: [BOX] }))
    expect(block()!.style.clipPath).toContain(BOX_HOLE)
  })

  it('a card: a zero-size stand-in off the screen, so no hole shows', () => {
    showSpot(spot({ key: '', box: null }))
    expect(lit()!.parentElement).toBe(host)
    expect(parseFloat(lit()!.style.left) + 6).toBeLessThan(0) // its 6 px padding included
    expect(lit()!.style.width).toBe('0px')
    expect(fake.setConfig).toHaveBeenLastCalledWith(expect.objectContaining({ animate: false }))
  })

  // Motion row 5: a plug of dimming over the cut-out fades in (120 ms), then out on the new one (180 ms).
  it('between screens the cut-out fades shut while the dimming stays, then fades open on the new target', async () => {
    showSpot(spot({}))
    const calls = fake.highlight.mock.calls.length
    showSpot(spot({ key: '', box: null }))
    expect(fake.highlight.mock.calls.length).toBe(calls) // the old hole stays, under the plug
    const plug = host.querySelector<HTMLElement>('.wt-plug')!
    expect(plug.style.clipPath).toContain(BOX_HOLE)
    expect(plug.style.opacity).toBe('1')
    expect(plug.style.transition).toContain('120ms')
    // The next step's tags are set but not measured yet: it stays shut, nothing redrawn.
    showSpot(spot({ key: 't.search', box: null }))
    expect(plug.style.opacity).toBe('1')
    expect(fake.highlight.mock.calls.length).toBe(calls)
    showSpot(spot({ key: 't.search', box: OTHER }))
    expect(lit()!.style.left).toBe('400px')
    expect(plug.style.opacity).toBe('1') // covers the new hole until driver.js has drawn it
    expect(plug.style.clipPath).not.toContain(BOX_HOLE)
    await frame()
    await frame()
    expect(plug.style.opacity).toBe('0')
    expect(plug.style.transition).toContain('180ms')
  })

  // A phone's cut-out waits for its sheet (WalkthroughHost): dimming first, then the hole fades open.
  it('dimming drawn before its target is measured: the cut-out fades open, never pops', async () => {
    showSpot(spot({ box: null }))
    showSpot(spot({}))
    const plug = host.querySelector<HTMLElement>('.wt-plug')!
    expect(lit()!.style.left).toBe('100px')
    expect(plug.style.opacity).toBe('1')
    await frame()
    await frame()
    expect(plug.style.opacity).toBe('0')
    expect(plug.style.transition).toContain('180ms')
  })

  it('a new target on the same screen glides; with reduced motion it jumps', () => {
    showSpot(spot({}))
    const first = lit()
    showSpot(spot({ key: 't.search', box: OTHER }))
    expect(fake.setConfig).toHaveBeenLastCalledWith(expect.objectContaining({ animate: true }))
    expect(lit()).not.toBe(first) // driver.js glides only between two elements
    showSpot(spot({ key: 't.head', box: BOX, calm: true }))
    expect(fake.setConfig).toHaveBeenLastCalledWith(expect.objectContaining({ animate: false }))
  })

  it('an apart step: the other cut-outs are added to its path, and again after it redraws', async () => {
    showSpot(spot({ holes: [OTHER, BOX] }))
    expect(lit()!.style.left).toBe('400px')
    await frame()
    expect(path().getAttribute('d')).toBe(`M0 0H800V600H0Z${BOX_HOLE}`)
    path().setAttribute('d', 'M0 0H900V600H0Z') // driver.js redraws (a resize)
    await Promise.resolve()
    expect(path().getAttribute('d')).toBe(`M0 0H900V600H0Z${BOX_HOLE}`)
  })

  it('inside a modal dialog: our layer becomes the dialog’s driver-layer, holding the stand-ins', () => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    dialog.append(host)
    showSpot(spot({}))
    expect(host.classList.contains('driver-layer')).toBe(true)
    expect(lit()!.parentElement).toBe(host)
    dialog.remove()
  })

  // driver.js's own stand-in for "nothing" sits in the body, which would pull its dimming out of the dialog.
  it('inside a modal dialog, a step with nothing to light keeps driver.js on our stand-ins', () => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    dialog.append(host)
    showSpot(spot({ key: '', box: null }))
    expect(fake.highlight).not.toHaveBeenCalledWith({})
    expect(lit()!.parentElement).toBe(host)
    dialog.remove()
  })

  it('at the end: unblocked at once, faded for 150 ms, then nothing of driver.js is left', async () => {
    showSpot(spot({}))
    const stand = lit()!
    hideSpot()
    expect(block()).toBeNull()
    expect(fake.svg.hasAttribute('data-leaving')).toBe(true)
    expect(fake.destroy).not.toHaveBeenCalled()
    await pause(160)
    expect(fake.destroy).toHaveBeenCalled()
    expect(stand.isConnected).toBe(false)
  })
})
