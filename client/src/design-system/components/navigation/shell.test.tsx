// Tests for the app shell pieces (CP-23): BackButton, TopBar's back, PhoneBar, NavDrawer.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackButton } from './BackButton'
import { NavDrawer } from './NavDrawer'
import { PhoneBar } from './PhoneBar'
import { TopBar } from './TopBar'

describe('app shell', () => {
  afterEach(cleanup)

  it('BackButton names the place and calls back', () => {
    const onClick = vi.fn()
    render(<BackButton label="Back to Assessments" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Assessments' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('TopBar gives the whole title on hover only while the two-line clamp cuts it', () => {
    const long = 'A very long site name that the clamp will cut'
    // jsdom has no layout: the heading's heights are set by hand (3 lines of text in 2 lines' room).
    const heights = (scroll: number) =>
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.tagName === 'H1' ? scroll : 0
      })
    const cut = heights(115)
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(77)
    const { rerender } = render(<TopBar title={long} />)
    // Measured when the pointer comes over the heading, so it is right after a resize.
    fireEvent.pointerEnter(screen.getByRole('heading', { level: 1 }))
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe(long)
    // Shown in full: no title, so a screen reader does not read the heading twice.
    cut.mockRestore()
    const whole = heights(38)
    rerender(<TopBar title="Clients" />)
    fireEvent.pointerEnter(screen.getByRole('heading', { level: 1 }))
    expect(screen.getByRole('heading', { level: 1 }).hasAttribute('title')).toBe(false)
    whole.mockRestore()
    client.mockRestore()
  })

  it('TopBar shows the Back button only when given a back action', () => {
    const { rerender } = render(<TopBar title="Clients" />)
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
    rerender(<TopBar title="Northgate" back={{ label: 'Back to Clients', onClick: () => {} }} />)
    expect(screen.getByRole('button', { name: 'Back to Clients' })).toBeTruthy()
  })

  it('PhoneBar opens the menu from the panel button', () => {
    const onMenu = vi.fn()
    render(<PhoneBar onMenu={onMenu} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(onMenu).toHaveBeenCalled()
    expect(screen.getByText('Risk Report Generator')).toBeTruthy()
  })

  it('NavDrawer closes on Esc and on a tap on the scrim', () => {
    const onClose = vi.fn()
    render(
      <NavDrawer open onClose={onClose}>
        <p>items</p>
      </NavDrawer>,
    )
    const drawer = document.querySelector('dialog')!
    fireEvent(drawer, new Event('cancel', { cancelable: true }))
    fireEvent.click(drawer)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
