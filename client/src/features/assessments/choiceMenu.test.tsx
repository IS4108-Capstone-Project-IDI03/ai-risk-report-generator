// Tests for our own dropdown (CP-22): keyboard use inside the open menu.
// Covers components/ChoiceMenu.tsx.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoiceMenu } from './components/ChoiceMenu'

const choices = ['Low', 'Moderate', 'High'].map((l) => ({ value: l.toLowerCase(), label: l }))

function openMenu() {
  render(
    <ChoiceMenu
      label="Severity"
      trigger={(_, toggle) => <button onClick={toggle}>Severity</button>}
      choices={choices}
      selected={[]}
      onChoose={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Severity' }))
  return screen.getAllByRole('menuitemradio')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChoiceMenu', () => {
  it('moves between choices with the arrow keys, wrapping at the ends, and Home/End', () => {
    const [low, moderate, high] = openMenu()
    low.focus()
    fireEvent.keyDown(low, { key: 'ArrowDown' })
    expect(moderate).toHaveFocus()
    fireEvent.keyDown(moderate, { key: 'End' })
    expect(high).toHaveFocus()
    fireEvent.keyDown(high, { key: 'ArrowDown' })
    expect(low).toHaveFocus()
    fireEvent.keyDown(low, { key: 'ArrowUp' })
    expect(high).toHaveFocus()
    fireEvent.keyDown(high, { key: 'Home' })
    expect(low).toHaveFocus()
  })
})

describe('ChoiceMenu on a phone', () => {
  it('lets its sheet size itself instead of capping the list, and ends in Cancel', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    // jsdom has no layout: the list is 300 px tall and the room under it only 100 px.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 100,
    } as DOMRect)
    openMenu()
    expect(screen.getByRole('menu', { name: 'Severity' }).style.maxHeight).toBe('')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
