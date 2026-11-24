// The walkthrough engine (F-12, test seam 3): starting away from the walkthrough's screen, tell-only
// walkthroughs on the practice assessment, a press that loads a screen, and a queue with try-its.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '../../design-system'
import { play, tryItRunning, useWalkthroughs } from './engine'
import { ALL_DONE, BUSY } from './player'
import { signal } from './signals'
import { net, plain, PRACTICE_PLACE, press, setUpEngineTests, wait } from './engineTestKit'
import { Harness } from './testKit'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

setUpEngineTests()

describe('started away from its screen', () => {
  it('a place reached by a press is pressed even when the URL already matches', async () => {
    const pressed = vi.fn()
    const onClick = (e: Event) =>
      (e.target as Element).closest('[data-walk="t.button"]') && pressed()
    document.addEventListener('click', onClick)
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['proposal']))
    await wait(300)
    expect(pressed).toHaveBeenCalledTimes(1)
    document.removeEventListener('click', onClick)
  })

  it('a tag ending in "?" is lit only when it is on the screen', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="proposal" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['proposal']))
    await wait(300)
    expect(screen.getByText('A proposal.')).toBeTruthy()
    expect(useWalkthroughs.getState().targets).toEqual(['t.search'])
  })

  it('never leaves unsaved work: it says so and plays nothing', async () => {
    render(<Harness screen="other" hold="unsaved" />)
    act(() => play(['client-page']))
    await wait(300)
    expect(window.location.pathname).not.toBe('/clients')
    expect(screen.getByText(plain(BUSY))).toBeTruthy()
    expect(useWalkthroughs.getState().running).toBeNull()
  })

  it('Back is off where the step before cannot show again, and Next waits for the step to show', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    act(() => signal('answered'))
    // Between steps (no bubble yet): an arrow key press must not skip the step that is coming.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await wait(1300)
    expect(screen.getByText('All done.')).toBeTruthy()
    // The step before was hands-on: its action is used up, so Back is greyed and does nothing.
    expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    await wait(300)
    expect(screen.getByText('All done.')).toBeTruthy()
  })

  it('goes to the path, presses each open tag as it settles, then waits for the screen', async () => {
    const pressed = vi.fn()
    document.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-walk="t.button"]')) pressed(window.location.pathname)
    })
    render(<Harness screen="other" />)
    act(() => play(['client-page']))
    await wait(300)
    expect(window.location.pathname).toBe('/clients')
    expect(pressed).toHaveBeenCalledWith('/clients')
    expect(screen.queryByText('A client.')).toBeNull() // still waiting for the 'client-page' screen
    await wait(4300)
    expect(screen.getByText('A client.')).toBeTruthy()
  })
})

describe('tell-only walkthroughs and the practice assessment', () => {
  it('a tell-only one offered on a real assessment plays right there', async () => {
    const real = '/assessment?ref=RPT-2026-0239&tab=checklist'
    window.history.replaceState(null, '', real)
    render(<Harness screen="checklist" record={{ practice: 'PRACTICE-0001' }} />)
    await wait(700)
    press('Show me')
    await wait(200)
    expect(window.location.pathname + window.location.search).toBe(real)
    expect(screen.getByText('The checklist.')).toBeTruthy()
  })

  it('is offered even with no practice assessment; a replay from elsewhere sets one up and opens it', async () => {
    render(<Harness screen="checklist" />)
    await wait(700)
    expect(screen.getByText('Checklist offer.')).toBeTruthy()
    cleanup()
    render(<Harness />)
    act(() => play(['checklist']))
    await wait(100)
    expect(toast.info).toHaveBeenCalledWith('Practice assessment set up again')
    expect(window.location.search).toBe('?ref=PRACTICE-0001&tab=checklist')
  })
})

describe('after a press that loads a screen', () => {
  it("waits up to 8 s for the next step after the person's last press", async () => {
    const appear = (tag: string) => {
      const el = document.createElement('button')
      el.setAttribute('data-walk', tag)
      el.textContent = tag
      document.body.append(el)
      return el
    }
    render(<Harness screen="slow" />)
    act(() => play(['slow']))
    await wait(200)
    press('Add')
    await wait(5000)
    const late = appear('t.late')
    await wait(300)
    fireEvent.click(late)
    await wait(5000)
    const later = appear('t.later')
    await wait(600)
    expect(screen.getByText('Late one.')).toBeTruthy()
    late.remove()
    later.remove()
  }, 20_000)
})

describe('a queue', () => {
  it('plays in order, asking between two, and ends with the fixed last line', async () => {
    render(<Harness role="knowledge_admin" />)
    act(() => play(['accounts', 'clients']))
    await wait(200)
    press('Finish')
    await wait(50)
    expect(
      screen.getByText(
        "That's Manage user accounts done. Next up is Find a client. Shall we carry on?",
      ),
    ).toBeTruthy()
    press('Carry on')
    await wait(200)
    expect(screen.getByText('Search here.')).toBeTruthy()
    for (let i = 0; i < 3; i++) {
      press(i === 2 ? 'Finish' : 'Next')
      await wait(i === 0 ? 4300 : 400)
    }
    expect(screen.getByText(plain(ALL_DONE))).toBeTruthy()
  })

  it('a try-it whose check fails says its line, then moves to the next', async () => {
    net.checkOk = false
    render(<Harness role="knowledge_admin" />)
    act(() => play(['chat', 'accounts']))
    await wait(50)
    expect(screen.getByText('Please try again later.')).toBeTruthy()
    press('OK')
    await wait(200)
    expect(screen.getByText('Accounts.')).toBeTruthy()
  })

  it('a try-it that fails part-way ends with the fixed line', async () => {
    render(<Harness screen="chat" />)
    act(() => play(['chat']))
    await wait(200)
    act(() => signal('try-it-failed'))
    expect(screen.getByText(/that didn't work this time/)).toBeTruthy()
    expect(tryItRunning()).toBeNull()
  })

  it('names the try-it running, for the x-walkthrough header', async () => {
    render(<Harness />)
    act(() => play(['chat']))
    await wait(200)
    expect(tryItRunning()).toBe('chat')
  })
})
