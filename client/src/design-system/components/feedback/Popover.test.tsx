import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Popover } from './Popover'

afterEach(cleanup)

// A minimal controlled host, like the one a feature would write: a trigger
// button and the popover whose open state it owns.
function Harness({ onClose, fixed }: { onClose?: () => void; fixed?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      fixed={fixed}
      align={fixed ? 'left' : undefined}
      ariaLabel="Notifications"
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onClose?.()
      }}
      trigger={<button onClick={() => setOpen((v) => !v)}>Open</button>}
    >
      <button>Inside action</button>
    </Popover>
  )
}

describe('Popover', () => {
  it('is closed by default and marks the trigger not expanded', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Inside action')).not.toBeInTheDocument()
  })

  it('opens on the trigger, revealing its content and marking it expanded', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByText('Inside action')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('marks the trigger as a popup control for assistive tech', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-haspopup')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Inside action')).not.toBeInTheDocument()
  })

  it('closes on a click outside, but not on a click inside', () => {
    const onClose = vi.fn()
    render(
      <>
        <Harness onClose={onClose} />
        <button>Elsewhere</button>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    // A click inside the surface keeps it open.
    fireEvent.mouseDown(screen.getByText('Inside action'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Inside action')).toBeInTheDocument()

    // A click outside closes it.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the trigger when it closes', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(trigger).toHaveFocus()
  })

  it('placed against the window, closes when focus moves outside and leaves focus there', () => {
    render(
      <>
        <Harness fixed />
        <button>Elsewhere</button>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const inside = screen.getByText('Inside action')
    inside.focus()
    // Inside the surface, or the trigger: stays open.
    fireEvent.focusOut(inside, { relatedTarget: screen.getByRole('button', { name: 'Open' }) })
    expect(screen.getByText('Inside action')).toBeInTheDocument()
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    fireEvent.focusOut(inside, { relatedTarget: elsewhere })
    expect(screen.queryByText('Inside action')).not.toBeInTheDocument()
    expect(elsewhere).toHaveFocus()
  })

  it('names the surface for assistive tech', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('moves sideways onto the screen where its side of the trigger has too little room', () => {
    // jsdom lays nothing out, so the surface reports where a phone would put it: 280px
    // wide (offsetWidth, which ignores the scale-in animation), 100px off the screen.
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280)
    const left = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(-100)
    const box = { mockRestore: () => (width.mockRestore(), left.mockRestore()) }
    try {
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveStyle({
        transform: 'translateX(108px)',
      })
    } finally {
      box.mockRestore()
    }
  })

  it('placed against the window, opens above a trigger near the bottom', () => {
    // A 320 x 300 surface; the trigger sits at 600-640 px in a 1024 x 768 window.
    const spies = [
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320),
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300),
      vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ top: 600, bottom: 640, left: 100, right: 200 } as DOMRect),
    ]
    try {
      render(<Harness fixed />)
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveStyle({
        position: 'fixed',
        top: '292px',
        left: '100px',
      })
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })

  it('placed against the window, takes the roomier side capped to it when neither side fits', () => {
    // A 380 px surface in a 560 px window; the trigger at 280-320 leaves 264 above, 224 below.
    vi.stubGlobal('innerHeight', 560)
    const spies = [
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320),
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(380),
      vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ top: 280, bottom: 320, left: 100, right: 200 } as DOMRect),
    ]
    try {
      render(<Harness fixed />)
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      const surface = screen.getByRole('dialog', { name: 'Notifications' })
      expect(surface).toHaveStyle({ top: '8px' })
      expect(surface).toHaveAttribute('data-cap')
      expect(surface.style.getPropertyValue('--cap')).toBe('264px')
    } finally {
      spies.forEach((s) => s.mockRestore())
      vi.unstubAllGlobals()
    }
  })

  it('placed against the window, follows a small scroll and closes once its trigger scrolls out', () => {
    // The trigger scrolls inside a box at 100-700 px; one place per frame, run by `frame()`.
    let trigger = { top: 600, bottom: 640, left: 100, right: 200 }
    const frames: FrameRequestCallback[] = []
    const frame = () => act(() => frames.splice(0).forEach((f) => f(0)))
    const spies = [
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb)),
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320),
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300),
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return (this.dataset.box !== undefined ? { top: 100, bottom: 700 } : trigger) as DOMRect
      }),
    ]
    const onClose = vi.fn()
    try {
      render(
        <div data-box="">
          <Harness fixed onClose={onClose} />
        </div>,
      )
      const box = document.querySelector<HTMLElement>('[data-box]')!
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      trigger = { ...trigger, top: 620, bottom: 660 }
      fireEvent.scroll(box)
      fireEvent.scroll(box)
      expect(frames).toHaveLength(1)
      frame()
      expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveStyle({ top: '312px' })
      expect(onClose).not.toHaveBeenCalled()
      trigger = { ...trigger, top: 690, bottom: 730 }
      fireEvent.scroll(box)
      frame()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull()
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })
})
