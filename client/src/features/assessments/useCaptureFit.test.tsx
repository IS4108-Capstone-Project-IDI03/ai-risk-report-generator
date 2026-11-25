// Test for New Observation's card fit (CP-24): --cap-room is the room down to 16 px above the
// bottom of the scrolling area, but never less than the left card. Covers useCaptureFit.ts.
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCaptureFit } from './useCaptureFit'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Cards() {
  const grid = useCaptureFit<HTMLDivElement>()
  return (
    <div className="om-scroll" data-testid="scroller">
      <div ref={grid} data-testid="grid">
        <div data-testid="left" />
      </div>
    </div>
  )
}

// The grid starts 100 px below the scroller's top, which is 800 px tall; the left card is `left` tall.
function roomWith(left: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.testid === 'grid' ? 100 : 0
    return { top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(left)
  const { getByTestId } = render(<Cards />)
  return getByTestId('grid').style.getPropertyValue('--cap-room')
}

describe('useCaptureFit', () => {
  it('leaves room down to 16 px above the window bottom when the left card is shorter', () => {
    expect(roomWith(300)).toBe('684px') // 800 - 100 - 16
  })

  it('never goes below the left card’s own height', () => {
    expect(roomWith(900)).toBe('900px')
  })
})
