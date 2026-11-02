// Tests for our own dropdown (CP-22): keyboard use inside the open menu.
// Covers components/ChoiceMenu.tsx.
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
