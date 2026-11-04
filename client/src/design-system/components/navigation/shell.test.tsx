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
