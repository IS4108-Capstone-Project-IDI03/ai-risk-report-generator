// The walkthrough engine (F-12, test seam 3): hands-on steps and the quiet wait for the app's answer
// (its limit, leaving the screen, refusals, open presses). The spotlight on a hands-on step: engine.spotlight.test.tsx.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '../../design-system'
import { play, useWalkthroughs } from './engine'
import { skip, tell } from './player'
import { onSignal, signal } from './signals'
import { net, PRACTICE_PLACE, press, setUpEngineTests, wait } from './engineTestKit'
import { Harness } from './testKit'
import { useWalkthroughScreen } from './useWalkthroughScreen'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

setUpEngineTests()

describe('the quiet time after the person’s part', () => {
  it('a result that came before anything listened is not lost', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    act(() => signal('answered'))
    await wait(1300)
    expect(screen.getByText('All done.')).toBeTruthy()
  })

  it('the next step’s open press is made a second after the action, before the result is ready', async () => {
    const pressedAt: number[] = []
    const onClick = (e: Event) => {
      if (!(e.target as Element).closest('[data-walk="t.search"]')) return
      pressedAt.push(performance.now())
      const late = document.createElement('button')
      late.setAttribute('data-walk', 't.late')
      document.body.append(late)
    }
    document.addEventListener('click', onClick)
    render(<Harness />)
    act(() => play(['elsewhere']))
    await wait(200)
    const from = performance.now()
    press('Add')
    await wait(1400)
    expect(pressedAt).toHaveLength(1)
    expect(pressedAt[0] - from).toBeGreaterThanOrEqual(1000)
    expect(useWalkthroughs.getState().bubble).toBeNull() // still waiting for the result
    act(() => signal('read'))
    await wait(1300)
    expect(screen.getByText('Here it is.')).toBeTruthy()
    expect(pressedAt).toHaveLength(1) // not pressed again by the step itself
    document.removeEventListener('click', onClick)
    document.querySelector('[data-walk="t.late"]')?.remove()
  })

  it('an answer that sets the app working steps aside until its result', async () => {
    const heard = vi.fn()
    const stop = onSignal('sample-chosen', heard)
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    expect(heard).toHaveBeenCalled()
    expect(useWalkthroughs.getState()).toMatchObject({ bubble: null, dim: false })
    act(() => signal('sample-read'))
    await wait(1300)
    expect(screen.getByText('Read.')).toBeTruthy()
    stop()
  })

  it('a step after the first dismisses a toast left on screen; a skip still shows its own', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    expect(toast.dismiss).not.toHaveBeenCalled() // the first step keeps the practice one
    press('Add')
    act(() => signal('answered'))
    await wait(1300)
    expect(screen.getByText('All done.')).toBeTruthy()
    expect(toast.dismiss).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toast.info).toHaveBeenCalledWith('Walkthrough skipped', expect.anything())
    expect(toast.dismiss).toHaveBeenCalledTimes(1)
  })

  it('a hands-on step whose answer was refused shows again, so the person can act again', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    expect(useWalkthroughs.getState().bubble).toBeNull()
    act(() => signal('try-it-failed'))
    await wait(300)
    expect(screen.getByText('Press the button.')).toBeTruthy()
  })

  it('an answer that never comes: after 90 s the step shows again, and a screen reader is told meanwhile', async () => {
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    expect(useWalkthroughs.getState()).toMatchObject({ bubble: null, quiet: true })
    expect(screen.getByRole('status').textContent).toBe("I'll carry on when this is ready.")
    await wait(89_000)
    expect(useWalkthroughs.getState().bubble).toBeNull()
    await wait(1_500)
    await wait(200)
    expect(screen.getByText('Want a sample?')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('an answer that never comes when the step’s control has gone: it ends with the “didn’t work” line', async () => {
    render(<Harness />)
    act(() => play(['elsewhere']))
    await wait(200)
    press('Add')
    // The app is still busy with the first press: its control is not there to press again.
    document.querySelector('[data-walk="t.button"]')!.removeAttribute('data-walk')
    await wait(92_000) // the next step's open press a second in, then the 90 s limit
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(screen.getByText(/that didn't work this time/)).toBeTruthy()
  })

  it('a skip during the quiet wait clears its time limit', async () => {
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    act(() => skip()) // Esc takes no key in the wait; a skip still comes from leaving the screen
    await wait(91_000)
    await wait(200)
    // Nothing of the walkthrough comes back (the Clients screen's own first-open offer may show).
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(screen.queryByText('Want a sample?')).toBeNull()
  })

  // New Observation: the engine's own Back opens the Observations list during the wait; leaving that
  // list then (an app link) ends the walkthrough at once, not at the 90 s limit.
  it('leaving the screen the wait’s own open press opened ends it at once as a skip', async () => {
    let goTo: (key: string) => void = () => {}
    function Screens() {
      const [key, setKey] = useState('clients')
      goTo = setKey
      useWalkthroughScreen(key, true)
      return null
    }
    const onClick = (e: Event) => {
      if (!(e.target as Element).closest('[data-walk="t.search"]')) return
      goTo('list') // the press opens the list
    }
    document.addEventListener('click', onClick)
    render(
      <>
        <Harness screen="base" />
        <Screens />
      </>,
    )
    act(() => play(['elsewhere']))
    await wait(200)
    press('Add')
    await wait(1300) // the open press is made a second in; the list says it is showing
    expect(useWalkthroughs.getState().running).not.toBeNull()
    act(() => goTo('away')) // the person leaves the list
    await wait(400)
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(net.patches).toContainEqual({ seen: { elsewhere: 'skipped' } })
    expect(toast.info).toHaveBeenCalledWith('Walkthrough skipped', expect.anything())
    document.removeEventListener('click', onClick)
  })

  it('leaving in the second before the wait’s own open press ends it as a skip; the press is not made', async () => {
    let goTo: (key: string) => void = () => {}
    function Screens() {
      const [key, setKey] = useState('clients')
      goTo = setKey
      useWalkthroughScreen(key, true)
      return null
    }
    const opened = vi.fn()
    const onClick = (e: Event) =>
      (e.target as Element).closest('[data-walk="t.search"]') && opened()
    document.addEventListener('click', onClick)
    render(
      <>
        <Harness screen="base" />
        <Screens />
      </>,
    )
    act(() => play(['elsewhere']))
    await wait(200)
    press('Add')
    await wait(300)
    act(() => goTo('away')) // the person leaves before the engine has pressed anything
    await wait(1500)
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(net.patches).toContainEqual({ seen: { elsewhere: 'skipped' } })
    expect(opened).not.toHaveBeenCalled()
    document.removeEventListener('click', onClick)
  })

  it('leaving the screen during the quiet wait ends the walkthrough as a skip, with its Replay toast', async () => {
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    press('Leave') // one of the app's own links: no Back event
    await wait(400)
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(net.patches).toContainEqual({ seen: { sample: 'skipped' } })
    expect(toast.info).toHaveBeenCalledWith('Walkthrough skipped', expect.anything())
  })

  it('the next step’s open press is not made when its screen is already showing', async () => {
    const pressed = vi.fn()
    const onClick = (e: Event) =>
      (e.target as Element).closest('[data-walk="t.search"]') && pressed()
    document.addEventListener('click', onClick)
    render(<Harness />)
    act(() => play(['elsewhere']))
    await wait(200)
    press('Add')
    // The person went there themselves within the first second: the new screen shows, and the
    // control the press was for (a Back button) is gone with the old one.
    const late = document.createElement('button')
    late.setAttribute('data-walk', 't.late')
    document.body.append(late)
    const back = document.querySelector('[data-walk="t.search"]')!
    back.setAttribute('data-walk', 't.gone')
    await wait(1300)
    expect(pressed).not.toHaveBeenCalled()
    act(() => signal('read'))
    await wait(1300)
    expect(screen.getByText('Here it is.')).toBeTruthy()
    document.removeEventListener('click', onClick)
    back.setAttribute('data-walk', 't.search')
    late.remove()
  })

  // The Review walkthrough's first finding shows on every section: its Section 7 row is still
  // pressed when it is not the current one, and left alone when it is.
  it('an open press is made while its control is not the current one, even with the target showing', async () => {
    const pressed = vi.fn()
    const onClick = (e: Event) =>
      (e.target as Element).closest('[data-walk="t.search"]') && pressed()
    document.addEventListener('click', onClick)
    const late = document.createElement('button')
    late.setAttribute('data-walk', 't.late')
    document.body.append(late)
    render(<Harness />)
    for (const current of [false, true]) {
      pressed.mockClear()
      const row = document.querySelector('[data-walk="t.search"]')!
      if (current) row.setAttribute('aria-current', 'true')
      act(() => play(['elsewhere']))
      await wait(200)
      press('Add')
      act(() => signal('read'))
      await wait(2500)
      expect(screen.getByText('Here it is.')).toBeTruthy()
      expect(pressed).toHaveBeenCalledTimes(current ? 0 : 1)
      act(() => skip())
      row.removeAttribute('aria-current')
    }
    document.removeEventListener('click', onClick)
    late.remove()
  })

  it('Esc during the quiet wait goes to the app and the walkthrough carries on', async () => {
    const appGot = vi.fn()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && appGot()
    document.addEventListener('keydown', onKey)
    render(<Harness />)
    act(() => play(['elsewhere']))
    await wait(200)
    press('Add')
    expect(useWalkthroughs.getState().quiet).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' }) // closing a menu, say
    expect(appGot).toHaveBeenCalledTimes(1)
    expect(useWalkthroughs.getState().running).not.toBeNull()
    expect(toast.info).not.toHaveBeenCalled() // no "Walkthrough skipped"
    const late = document.createElement('button')
    late.setAttribute('data-walk', 't.late')
    document.body.append(late)
    act(() => signal('read'))
    await wait(2500)
    expect(screen.getByText('Here it is.')).toBeTruthy()
    document.removeEventListener('keydown', onKey)
    late.remove()
  })

  it('a message shown during a step keeps its OK when the step’s action lands after it', async () => {
    render(<Harness />)
    act(() => play(['confirm']))
    await wait(200)
    act(() => tell('Your microphone is blocked.', 'concerned'))
    await wait(400)
    act(() => signal('confirm-saved')) // the person recorded anyway, with the message still up
    await wait(1300)
    expect(screen.getByText('Your microphone is blocked.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
    expect(useWalkthroughs.getState().quiet).toBe(false)
  })

  it('forgets a result heard early on Skip', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    act(() => signal('answered'))
    act(() => skip()) // Esc takes no key in the wait
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    await wait(1300)
    expect(useWalkthroughs.getState().bubble).toBeNull() // waits for a new answer
  })
})
