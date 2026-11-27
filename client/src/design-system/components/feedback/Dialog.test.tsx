// The shared Dialog: a click on the backdrop closes it (IN-17 follow-up), as Esc and the X do.
// jsdom has no layout, so the card's box is stubbed and the backdrop is any point outside it.
// Its close button is 44 x 44 on a phone and the usual size elsewhere (AS-06 round 9), set by the
// Dialog itself rather than by an !important rule in the stylesheet.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  // The card sits at 100,100 to 500,400 on screen.
  HTMLDialogElement.prototype.getBoundingClientRect = () =>
    ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }) as DOMRect
})
afterEach(cleanup)

const OUTSIDE = { clientX: 20, clientY: 20 }
const INSIDE = { clientX: 200, clientY: 200 }

function open(onClose?: () => void) {
  render(
    <Dialog title="Passages" onClose={onClose}>
      <p>Body text</p>
    </Dialog>,
  )
  return screen.getByRole('dialog')
}

// A press and release, then the click the browser sends to the element both landed on.
function clickAt(down: Element, up: Element, point: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(down, point)
  fireEvent.pointerUp(up, point)
  fireEvent.click(up, point)
}

describe('Dialog', () => {
  it('closes on a click on the backdrop', () => {
    const onClose = vi.fn()
    const dialog = open(onClose)

    clickAt(dialog, dialog, OUTSIDE)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open on a click inside the card, even on a gap between its parts', () => {
    const onClose = vi.fn()
    const dialog = open(onClose)

    clickAt(screen.getByText('Body text'), screen.getByText('Body text'), INSIDE)
    // A gap: the click lands on the <dialog> itself, but within its box.
    clickAt(dialog, dialog, INSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when a press inside is dragged out and released on the backdrop', () => {
    const onClose = vi.fn()
    const dialog = open(onClose)

    // Selecting text from the body outwards: the browser clicks their common ancestor.
    fireEvent.pointerDown(screen.getByText('Body text'), INSIDE)
    fireEvent.pointerUp(dialog, OUTSIDE)
    fireEvent.click(dialog, OUTSIDE)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('never closes on the backdrop when it has no way to close', () => {
    const dialog = open(undefined)

    clickAt(dialog, dialog, OUTSIDE)

    expect(dialog).toHaveAttribute('open')
  })

  it('returns focus to the opener without scrolling the page', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const focus = vi.spyOn(opener, 'focus')
    const { unmount } = render(<Dialog title="Ask">body</Dialog>)

    unmount()

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    opener.remove()
  })
})

const phone = (yes: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: yes && query.includes('max-width: 767px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))

describe('Dialog close button', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is 44 x 44 on a phone, with or without a title', () => {
    phone(true)
    render(<Dialog title="Edit" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: '44px',
      height: '44px',
    })
    cleanup()
    render(<Dialog ariaLabel="Plain" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: '44px',
      height: '44px',
    })
  })

  it('keeps the small icon-button size above 768 px', () => {
    phone(false)
    render(<Dialog title="Edit" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: 'var(--control-height-sm)',
    })
  })
})
