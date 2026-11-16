// Tooltip (AS-06 round 9): the default opens on hover or focus only; a `tap` tooltip also opens on
// a click or tap and closes on a press elsewhere, as a phone has no hover. Draws it straight.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
})
