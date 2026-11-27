// Test for the menu's flip inside a card (CP-24): a menu wider than the card it opens in is
// right-aligned to its trigger. Covers design-system/components/forms/ChoiceMenu.tsx.
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoiceMenu } from '../../design-system'

afterEach(() => vi.restoreAllMocks())

describe('ChoiceMenu inside a card', () => {
  it('flips to the trigger’s right edge when it would run past the card', () => {
    // jsdom has no layout: say the card ends at 200 px and the open menu at 300 px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const right = this.classList.contains('ob-card')
        ? 200
        : this.classList.contains('ob-menu-surface')
          ? 300
          : 100
      return { left: 0, top: 0, bottom: 0, width: right, height: 0, right, x: 0, y: 0 } as DOMRect
    })
    render(
      <div className="ob-card">
        <ChoiceMenu
          label="Severity"
          trigger={(_, toggle) => <button onClick={toggle}>Severity</button>}
          choices={[{ value: 'low', label: 'Low' }]}
          selected={[]}
          onChoose={() => {}}
        />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Severity' }))
    const surface = document.querySelector<HTMLElement>('.ob-menu-surface')!
    expect(surface.style.left).toBe('auto')
    expect(surface.style.right).toBe('0px')
  })
})

describe('ChoiceMenu in a phone sheet', () => {
  it('is never capped to the room under the trigger', () => {
    // A phone: the menu opens as a sheet (jsdom has no matchMedia, so say so).
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia
    // While the sheet slides in, its list sits below the screen: no room, and taller than that.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 2000,
      bottom: 2300,
      width: 100,
      height: 300,
      right: 100,
      x: 0,
      y: 2000,
    } as DOMRect)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300)
    render(
      <ChoiceMenu
        label="Status"
        trigger={(_, toggle) => <button onClick={toggle}>Status</button>}
        choices={[{ value: 'a', label: 'A' }]}
        selected={[]}
        onChoose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    const list = document.querySelector<HTMLElement>('.ds-sheet ul.ob-menu')!
    expect(list.style.maxHeight).toBe('')
    delete (window as { matchMedia?: unknown }).matchMedia
  })
})
