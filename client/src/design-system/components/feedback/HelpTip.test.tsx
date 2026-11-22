// HelpTip (F-13 test seam 1): opens on press and on keyboard focus plus Enter, closes on Esc and
// on a press outside, and shows "Show me" only when given `onShowMe`.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HelpTip } from './HelpTip'

afterEach(cleanup)

const button = () => screen.getByRole('button', { name: 'How to review the draft' })

describe('HelpTip', () => {
  it('is closed until pressed, then shows its words and names the popover', () => {
    render(<HelpTip label="How to review the draft">Accept keeps it as drafted.</HelpTip>)
    expect(screen.queryByText('Accept keeps it as drafted.')).not.toBeInTheDocument()
    fireEvent.click(button())
    expect(screen.getByRole('dialog', { name: 'How to review the draft' })).toHaveTextContent(
      'Accept keeps it as drafted.',
    )
    expect(button()).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens from the keyboard: a focusable native button, so Enter is a click', () => {
    render(<HelpTip label="How to review the draft">Words</HelpTip>)
    button().focus()
    expect(document.activeElement).toBe(button())
    expect(button().tagName).toBe('BUTTON')
    // Enter on a native button fires click; jsdom has no key-to-click step, so send what it sends.
    fireEvent.keyDown(button(), { key: 'Enter' })
    fireEvent.click(button())
    expect(screen.getByText('Words')).toBeInTheDocument()
  })

  it('closes on Esc and on a press outside', () => {
    render(<HelpTip label="How to review the draft">Words</HelpTip>)
    fireEvent.click(button())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Words')).not.toBeInTheDocument()
    fireEvent.click(button())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('Words')).not.toBeInTheDocument()
  })

  it('shows Show me only when given onShowMe, then closes the popover', () => {
    const { unmount } = render(<HelpTip label="How to review the draft">Words</HelpTip>)
    fireEvent.click(button())
    expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument()
    unmount()

    const onShowMe = vi.fn()
    render(
      <HelpTip label="How to review the draft" onShowMe={onShowMe}>
        Words
      </HelpTip>,
    )
    fireEvent.click(button())
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }))
    expect(onShowMe).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Words')).not.toBeInTheDocument()
  })
})
