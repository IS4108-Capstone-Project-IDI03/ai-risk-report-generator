// A second navigation during the old page's fade (CP-23, v2 section 8): one copy keeps
// fading and the new screen waits for it. jsdom has no element.animate, so it is stubbed.
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ScreenMotion } from './ScreenMotion'

function Page({ screen, depth = 0 }: { screen: string; depth?: number }) {
  const main = useRef<HTMLElement>(null)
  return (
    <div data-testid="column">
      <ScreenMotion screenKey={screen} depth={depth} main={main} />
      <main ref={main}>{screen}</main>
    </div>
  )
}

const animate = vi.fn()
const cancel = vi.fn()
beforeEach(() => {
  animate.mockReset().mockReturnValue({ cancel })
  cancel.mockReset()
  Element.prototype.animate = animate
})
afterEach(() => {
  // @ts-expect-error jsdom does not have it; put that back for the other tests.
  delete Element.prototype.animate
  vi.unstubAllGlobals()
})

test('a second navigation during the fade keeps the one copy of the first page', () => {
  const { rerender, container } = render(<Page screen="clients" />)
  rerender(<Page screen="assessments" />)
  rerender(<Page screen="users" />)
  const copies = container.querySelectorAll('.screen-exit')
  expect(copies).toHaveLength(1)
  expect(copies[0].textContent).toBe('clients')
  // The last screen's entrance replaced the one before it, and waits for the fade to end.
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(animate.mock.lastCall?.[1].delay).toBeGreaterThan(0)
})

test('with reduced motion there is no copy and no wait', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const { rerender, container } = render(<Page screen="clients" />)
  rerender(<Page screen="assessments" />)
  expect(container.querySelector('.screen-exit')).toBeNull()
  expect(animate.mock.lastCall?.[1].delay).toBe(0)
})
