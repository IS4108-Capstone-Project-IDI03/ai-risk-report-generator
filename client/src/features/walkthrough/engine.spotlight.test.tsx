// The walkthrough engine (F-12, test seam 3): the spotlight on a hands-on step (letting go at the
// first press, shutting before a press that changes the screen, a refused save, no pull-back on scroll).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { play, useWalkthroughs } from './engine'
import { signal } from './signals'
import { press, setUpEngineTests, wait } from './engineTestKit'
import { Harness } from './testKit'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

setUpEngineTests()

describe('hands-on spotlight', () => {
  it('a step with more to do lets the spotlight go at the first press inside it; it never comes back', async () => {
    render(<Harness />)
    act(() => play(['pick']))
    await wait(200)
    expect(useWalkthroughs.getState()).toMatchObject({
      dim: true,
      ring: 'on',
      targets: ['t.search'],
    })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add' })) // outside the cut-out
    expect(useWalkthroughs.getState().dim).toBe(true)
    fireEvent.pointerDown(screen.getByLabelText('Search'))
    expect(useWalkthroughs.getState()).toMatchObject({ dim: false, ring: 'off' })
    // The words show whole, and the bubble keeps its place and its "Your turn".
    expect(useWalkthroughs.getState().bubble).toMatchObject({ say: 'Pick one.', rushed: true })
    expect(useWalkthroughs.getState().bubble?.step?.hands).toBe(true)
    act(() => signal('picked'))
    await wait(100)
    expect(useWalkthroughs.getState()).toMatchObject({ dim: false, ring: 'off' })
    expect(screen.getByText('Pick one.')).toBeTruthy()
    press('Add')
    expect(useWalkthroughs.getState().bubble).toBeNull()
    await wait(1300)
    expect(screen.getByText('Picked.')).toBeTruthy()
  })

  it('once a step has let go, Esc in the page’s control is the page’s; from the bubble it still skips', async () => {
    const appGot = vi.fn()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && appGot()
    document.addEventListener('keydown', onKey)
    render(<Harness />)
    act(() => play(['pick']))
    await wait(200)
    const search = screen.getByLabelText('Search')
    fireEvent.keyDown(search, { key: 'Escape' }) // still dimmed: the walkthrough holds the page
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(appGot).not.toHaveBeenCalled()
    act(() => play(['pick']))
    await wait(200)
    fireEvent.pointerDown(search)
    fireEvent.keyDown(search, { key: 'Escape' }) // closing the list they opened
    expect(appGot).toHaveBeenCalledTimes(1)
    expect(useWalkthroughs.getState().running).not.toBeNull()
    fireEvent.keyDown(screen.getByText('Pick one.'), { key: 'Escape' })
    expect(useWalkthroughs.getState().running).toBeNull()
    document.removeEventListener('keydown', onKey)
  })

  it('a step that opens another screen shuts the cut-out before its press, and keeps it shut until the next target', async () => {
    const seen: { targets: string[] | null; at: number }[] = []
    const onClick = (e: Event) => {
      if (!(e.target as Element).closest('[data-walk="t.button"]')) return
      seen.push({ targets: useWalkthroughs.getState().targets, at: performance.now() })
      const late = document.createElement('button')
      late.setAttribute('data-walk', 't.late')
      document.body.append(late)
    }
    document.addEventListener('click', onClick)
    render(<Harness />)
    act(() => play(['reopen']))
    await wait(200)
    const from = performance.now()
    press('Next')
    await wait(600)
    expect(seen).toHaveLength(1)
    expect(seen[0].targets).toBeNull() // shut: no cut-out while the press changes the screen
    expect(seen[0].at - from).toBeGreaterThanOrEqual(120) // after the 120 ms fade
    expect(screen.getByText('Second.')).toBeTruthy()
    document.removeEventListener('click', onClick)
    document.querySelector('[data-walk="t.late"]')?.remove()
  })

  // A hover-only control (the Category field's Confirm tick) shows only while it is marked itself.

  it('a refused save leaves the step showing; it moves on once the save lands', async () => {
    render(<Harness />)
    act(() => play(['confirm']))
    await wait(200)
    fireEvent.pointerDown(screen.getByText('Name'))
    fireEvent.click(screen.getByText('Name'))
    await wait(1500) // the save was refused: no signal
    expect(screen.getByText('Confirm it.')).toBeTruthy()
    act(() => signal('confirm-saved'))
    expect(useWalkthroughs.getState().bubble).toBeNull()
    await wait(1300)
    expect(screen.getByText('Confirmed.')).toBeTruthy()
  })

  it('once a signal step has let go, scrolling the page does not pull it back to the target', async () => {
    // jsdom lays nothing out: a page taller than the window, with the lit target scrolled away.
    const root = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 3000 })
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 700 })
    const scrollBy = vi.fn()
    root.scrollBy = scrollBy
    render(<Harness />)
    act(() => play(['pick']))
    await wait(200)
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      return this.hasAttribute('data-walk') ? new DOMRect(100, 2000, 120, 40) : new DOMRect()
    })
    const scrollAway = async () => {
      scrollBy.mockClear()
      fireEvent.scroll(window)
      await wait(500)
    }
    await scrollAway()
    expect(scrollBy).toHaveBeenCalled() // while lit, the target is put back in view
    fireEvent.pointerDown(screen.getByLabelText('Search'))
    await scrollAway()
    expect(scrollBy).not.toHaveBeenCalled()
    Reflect.deleteProperty(document, 'scrollingElement')
    Reflect.deleteProperty(root, 'scrollHeight')
    Reflect.deleteProperty(root, 'clientHeight')
  })
})
