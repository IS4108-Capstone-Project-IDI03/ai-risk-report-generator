// ChecklistGroups (F-12, the "collapsible checklist" pattern): groups open and close, a group's box
// ticks or half-ticks its items, rows can carry a mark and a hover action. Plain data in, no app code.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChecklistGroups, type ChecklistGroup } from './ChecklistGroups'

afterEach(cleanup)

const GROUPS: ChecklistGroup[] = [
  {
    id: 'a',
    name: 'Alpha',
    items: [
      { id: 'a1', name: 'First' },
      { id: 'a2', name: 'Second', mark: 'done', markLabel: 'Played' },
    ],
  },
  { id: 'b', name: 'Beta', items: [{ id: 'b1', name: 'Third' }] },
]

// A parent that owns the ticks, as a screen would; `seen` shows the latest selection.
function Host({ start = [] as string[] }) {
  const [selected, setSelected] = useState(start)
  return (
    <>
      <ChecklistGroups
        groups={GROUPS}
        selected={selected}
        onSelectedChange={setSelected}
        renderAction={(item) => <button>{`Do ${item.name}`}</button>}
      />
      <output data-testid="seen">{[...selected].sort().join(',')}</output>
    </>
  )
}
const seen = () => screen.getByTestId('seen').textContent
const group = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('ChecklistGroups', () => {
  it('starts closed: each group shows its count and hides its items', () => {
    render(<Host />)
    expect(group('Alpha')).toHaveAttribute('aria-expanded', 'false')
    expect(group('Alpha')).toHaveAccessibleName(/2 items/)
    // A group of one is spoken in the singular.
    expect(group('Beta')).toHaveAccessibleName(/1 item$/)
    expect(screen.queryByRole('checkbox', { name: 'First' })).not.toBeInTheDocument()
  })

  it('opens and closes on a press of the group name', () => {
    render(<Host />)
    fireEvent.click(group('Alpha'))
    expect(group('Alpha')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: 'First' })).toBeInTheDocument()
    fireEvent.click(group('Alpha'))
    expect(screen.queryByRole('checkbox', { name: 'First' })).not.toBeInTheDocument()
  })

  it('ticks a whole group from its box, and unticks it again', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in Alpha' }))
    expect(seen()).toBe('a1,a2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in Alpha' }))
    expect(seen()).toBe('')
  })

  it('half-ticks the group box while only some items are ticked, and ticks the rest on a press', () => {
    render(<Host start={['a1']} />)
    const box = screen.getByRole('checkbox', { name: 'Select all in Alpha' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    fireEvent.click(box)
    expect(seen()).toBe('a1,a2')
    expect(box.indeterminate).toBe(false)
    expect(box.checked).toBe(true)
  })

  it('ticks one item and leaves the other groups alone', () => {
    render(<Host />)
    fireEvent.click(group('Alpha'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Second' }))
    expect(seen()).toBe('a2')
    expect(
      (screen.getByRole('checkbox', { name: 'Select all in Beta' }) as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('shows a mark only where an item has one, and gives every row an action slot', () => {
    render(<Host />)
    fireEvent.click(group('Alpha'))
    expect(screen.getAllByRole('img', { name: 'Played' })).toHaveLength(1)
    const row = screen.getByRole('checkbox', { name: 'First' }).closest('li') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Do First' })).toBeInTheDocument()
  })

  it('works from the keyboard: the name is a native button and every box is a real checkbox', () => {
    render(<Host />)
    expect(group('Alpha').tagName).toBe('BUTTON')
    group('Alpha').focus()
    expect(document.activeElement).toBe(group('Alpha'))
    // Enter or Space on a native button is a click; jsdom has no key-to-click step.
    fireEvent.click(group('Alpha'))
    expect(screen.getByRole('checkbox', { name: 'First' })).toHaveAttribute('type', 'checkbox')
  })
})
