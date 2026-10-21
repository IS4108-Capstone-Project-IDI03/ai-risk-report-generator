import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('closes a success toast after 5 seconds', () => {
    const onDismiss = vi.fn()
    render(<Toast tone="success" message="Saved" onDismiss={onDismiss} />)
    act(() => void vi.advanceTimersByTime(4900))
    expect(onDismiss).not.toHaveBeenCalled()
    // 5s, then the 200ms fade-out before the parent is told.
    act(() => void vi.advanceTimersByTime(100))
    act(() => void vi.advanceTimersByTime(200))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes an info toast too, but never a warning or danger one', () => {
    const info = vi.fn()
    const warn = vi.fn()
    const danger = vi.fn()
    render(<Toast tone="info" message="FYI" onDismiss={info} />)
    render(<Toast tone="warning" message="Careful" onDismiss={warn} />)
    render(<Toast tone="danger" message="Failed" onDismiss={danger} />)
    act(() => void vi.advanceTimersByTime(60000))
    act(() => void vi.advanceTimersByTime(200)) // the fade-out
    expect(info).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(danger).not.toHaveBeenCalled()
  })

  it('pauses while hovered and restarts the full 5 seconds on leave', () => {
    const onDismiss = vi.fn()
    render(<Toast tone="success" message="Saved" onDismiss={onDismiss} />)
    const card = screen.getByText('Saved').parentElement as HTMLElement
    act(() => void vi.advanceTimersByTime(3000))
    fireEvent.mouseEnter(card)
    act(() => void vi.advanceTimersByTime(20000))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.mouseLeave(card)
    act(() => void vi.advanceTimersByTime(4900))
    expect(onDismiss).not.toHaveBeenCalled()
    // 5s, then the 200ms fade-out before the parent is told.
    act(() => void vi.advanceTimersByTime(100))
    act(() => void vi.advanceTimersByTime(200))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('fades out before closing when the X is pressed', () => {
    const onDismiss = vi.fn()
    render(<Toast tone="warning" message="Careful" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('status').style.opacity).toBe('0')
    act(() => void vi.advanceTimersByTime(200))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while a control inside has keyboard focus', () => {
    const onDismiss = vi.fn()
    render(<Toast tone="success" message="Saved" onDismiss={onDismiss} />)
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss' }))
    act(() => void vi.advanceTimersByTime(20000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('shows a countdown bar only on tones that close themselves, and holds it full while paused', () => {
    const { container, rerender } = render(
      <Toast tone="success" message="Saved" onDismiss={vi.fn()} />,
    )
    const bar = () => container.querySelector('.toast-bar') as HTMLElement | null
    expect(bar()?.style.animation).toContain('toast-countdown 5000ms')
    fireEvent.mouseEnter(screen.getByRole('status'))
    expect(bar()?.style.animation).toBe('none')
    rerender(<Toast tone="warning" message="Careful" onDismiss={vi.fn()} />)
    expect(bar()).toBeNull()
  })

  it('announces danger as an alert and the rest as status', () => {
    render(<Toast tone="danger" message="Failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    cleanup()
    render(<Toast tone="info" message="FYI" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
