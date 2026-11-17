// Tooltip (AS-06 round 9): the default opens on hover or focus only; a `tap` tooltip also opens on
// a click or tap and closes on a press elsewhere, as a phone has no hover. Draws it straight.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('opens on hover and not on a click when it is not a tap tooltip', () => {
    render(
      <Tooltip label="Plain">
        <button type="button">Trigger</button>
      </Tooltip>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('button').parentElement!)
    expect(screen.getByRole('tooltip').textContent).toBe('Plain')
  })

  it('opens on a click with `tap`, closes on a press outside, and on Escape', () => {
    render(
      <>
        <p>Elsewhere</p>
        <Tooltip label="Tapped" tap>
          <button type="button">Trigger</button>
        </Tooltip>
      </>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // A second tap (hover then click, or a phone's emulated hover) keeps it open.
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('stays open when the press is on the tooltip’s own trigger', () => {
    render(
      <Tooltip label="Tapped" tap>
        <button type="button">Trigger</button>
      </Tooltip>,
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.pointerDown(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('places a bottom-start tooltip under the anchor, from its left edge', () => {
    render(
      <Tooltip label="Under" placement="bottom-start" tap>
        <button type="button">Trigger</button>
      </Tooltip>,
    )
    fireEvent.click(screen.getByRole('button'))
    const style = screen.getByRole('tooltip').style
    expect([style.top, style.left]).toEqual(['calc(100% + 6px)', '0px'])
  })

  it('opens on keyboard focus, but not on the focus a mouse press gives', () => {
    render(
      <Tooltip label="Plain">
        <button type="button">Trigger</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    // The browser says whether a focus came from the keyboard (:focus-visible). A mouse press
    // focuses the button too, and so does a dialog handing focus back after a click on Cancel:
    // no bubble then, or it would stay over the button until blur.
    const keyboard = vi.spyOn(button, 'matches').mockReturnValue(false)
    fireEvent.focus(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.blur(button)
    // Keyboard focus opens it, and blur closes it.
    keyboard.mockReturnValue(true)
    fireEvent.focus(button)
    expect(keyboard).toHaveBeenLastCalledWith(':focus-visible')
    expect(screen.getByRole('tooltip').textContent).toBe('Plain')
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('still opens on hover after a click focused the button', () => {
    render(
      <Tooltip label="Plain">
        <button type="button">Trigger</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)
    fireEvent.focus(button)
    fireEvent.mouseEnter(button.parentElement!)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(button.parentElement!)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('describes its trigger when the text is not the trigger’s own name, and not when it is', () => {
    render(
      <>
        <Tooltip label="Remove Pin">
          <button type="button" aria-label="Remove Pin for Site">
            x
          </button>
        </Tooltip>
        <Tooltip label="Close">
          <button type="button" aria-label="Close">
            x
          </button>
        </Tooltip>
        <Tooltip label="Opens in a new tab">
          <button type="button" aria-label="Directions">
            x
          </button>
        </Tooltip>
      </>,
    )
    const [remove, close, directions] = screen.getAllByRole('button')
    // The name already holds the tooltip's words: describing it too would say them twice.
    act(() => remove.focus())
    expect(remove).toHaveAccessibleName('Remove Pin for Site')
    expect(remove).not.toHaveAttribute('aria-describedby')
    act(() => close.focus())
    expect(close).not.toHaveAttribute('aria-describedby')
    // Words the name does not have describe it, and only while the bubble (their element) is open.
    expect(directions).not.toHaveAttribute('aria-describedby')
    act(() => directions.focus())
    expect(directions).toHaveAccessibleDescription('Opens in a new tab')
    act(() => directions.blur())
    expect(directions).not.toHaveAttribute('aria-describedby')
  })

  it('does not describe a trigger whose name holds every line of a two-line tooltip', () => {
    render(
      <Tooltip
        label={
          <span>
            Northgate Foods
            <br />
            RPT-2026-0001
          </span>
        }
      >
        <button type="button" aria-label="Northgate Foods, RPT-2026-0001. Open assessment details">
          x
        </button>
      </Tooltip>,
    )
    const button = screen.getByRole('button')
    act(() => button.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Northgate Foods')
    expect(button).not.toHaveAttribute('aria-describedby')
  })

  it('keeps a description the trigger already has', () => {
    render(
      <>
        <p id="own">Own words</p>
        <Tooltip label="Tip">
          <button type="button" aria-label="Name" aria-describedby="own">
            x
          </button>
        </Tooltip>
      </>,
    )
    const button = screen.getByRole('button')
    act(() => button.focus())
    expect(button).toHaveAccessibleDescription('Own words Tip')
  })
})
