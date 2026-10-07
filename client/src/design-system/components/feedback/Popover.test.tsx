import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Popover } from './Popover'

afterEach(cleanup)

// A minimal controlled host, like the one a feature would write: a trigger
// button and the popover whose open state it owns.
function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
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

  it('names the surface for assistive tech', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })
})
