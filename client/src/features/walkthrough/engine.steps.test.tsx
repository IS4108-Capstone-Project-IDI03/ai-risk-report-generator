// The walkthrough engine (F-12, test seam 3): steps (the settle rule, optional steps, roles, Skip and
// Finish, answers), the practice assessment, and an answer that takes too long.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '../../design-system'
import { play, setOffers, useWalkthroughs } from './engine'
import { LOST } from './player'
import { onSignal, signal } from './signals'
import {
  bar,
  net,
  offerText,
  plain,
  PRACTICE_PLACE,
  press,
  setUpEngineTests,
  wait,
} from './engineTestKit'
import { Harness } from './testKit'
import { useWalkthroughScreen } from './useWalkthroughScreen'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

setUpEngineTests()

describe('steps', () => {
  it('skips an optional step it cannot find and renumbers the bar; roles and admin words apply', async () => {
    render(<Harness />)
    act(() => play(['clients']))
    await wait(200)
    expect(bar()).toBe('Step 1 of 3')
    press('Next')
    await wait(4300)
    expect(screen.getByText('The table.')).toBeTruthy()
    expect(bar()).toBe('Step 2 of 2')
    cleanup()
    render(<Harness role="knowledge_admin" />)
    act(() => play(['clients']))
    await wait(200)
    expect(bar()).toBe('Step 1 of 4')
  })

  it('ends with the fixed message when a target never appears, leaving no dimming', async () => {
    render(<Harness />)
    act(() => play(['lost']))
    await wait(4300)
    expect(screen.getByText(plain(LOST))).toBeTruthy()
    expect(useWalkthroughs.getState().dim).toBe(false)
    expect(net.patches).toEqual([])
  })

  it('a hands-on step ignores Next; after its press nothing shows until its result is ready, then 1 s, then the next step', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations']))
    await wait(200)
    expect(useWalkthroughs.getState()).toMatchObject({ targets: ['t.button'], ring: 'on' })
    press('Next')
    expect(screen.getByText('Press the button.')).toBeTruthy()
    press('Add')
    // The person's part is done: bubble, dimming, cut-out and ring all go at once.
    expect(useWalkthroughs.getState()).toMatchObject({
      bubble: null,
      targets: null,
      dim: false,
      ring: 'off',
    })
    await wait(1200) // (its fail.slow line would come at 1.5 s)
    expect(useWalkthroughs.getState().bubble).toBeNull() // the app is still answering
    act(() => signal('answered'))
    await wait(800)
    expect(useWalkthroughs.getState().bubble).toBeNull() // the result shows alone for 1 s
    await wait(500)
    expect(screen.getByText('All done.')).toBeTruthy()
  })

  it('Esc skips: recorded, with a Replay toast', async () => {
    render(<Harness />)
    act(() => play(['clients']))
    await wait(200)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(net.patches).toEqual([{ seen: { clients: 'skipped' } }])
    expect(toast.info).toHaveBeenCalledWith(
      'Walkthrough skipped',
      expect.objectContaining({ action: expect.anything() }),
    )
  })

  it('finishing records played; browser Back during a walkthrough skips it', async () => {
    render(<Harness role="knowledge_admin" />)
    act(() => play(['accounts']))
    await wait(200)
    press('Finish')
    expect(net.patches).toEqual([{ seen: { accounts: 'played' } }])
    act(() => play(['clients']))
    await wait(200)
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(net.patches).toContainEqual({ seen: { clients: 'skipped' } })
  })

  it('an answer on a step fires its signal and moves on; the step keeps Skip, not the bar', async () => {
    const heard = vi.fn()
    const stop = onSignal('sample-chosen', heard)
    render(<Harness screen="form" />)
    act(() => play(['new-form']))
    await wait(200)
    expect(bar()).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Skip walkthrough' })).toBeTruthy()
    expect(useWalkthroughs.getState().dim).toBe(true)
    press('Use the sample email')
    expect(heard).toHaveBeenCalled()
    await wait(300)
    expect(screen.getByText('The form.')).toBeTruthy()
    stop()
  })

  it('switching offers back when the save fails', async () => {
    net.saveFails = true
    render(<Harness />)
    await expect(setOffers(false)).rejects.toBeTruthy()
    expect(useWalkthroughs.getState().record.offers).toBe(true)
  })

  it('marks what is highlighted with data-walk-on, and clears it when the step changes and at the end', async () => {
    render(<Harness role="knowledge_admin" />)
    act(() => play(['clients']))
    await wait(200)
    const marked = () =>
      [...document.querySelectorAll('[data-walk-on]')].map((el) => el.getAttribute('data-walk'))
    expect(marked()).toEqual(['t.search'])
    press('Next')
    await wait(4300) // the optional step is looked for, then skipped
    expect(marked()).toEqual(['t.admin'])
    fireEvent.keyDown(window, { key: 'Escape' })
    await wait(50)
    expect(marked()).toEqual([])
  })

  it('a screen that switches its key leaves the old screen and arrives at the new one', async () => {
    function Switching() {
      const [tab, setTab] = useState('form')
      useWalkthroughScreen(tab === 'form' ? 'form' : 'clients', true)
      return <button onClick={() => setTab('insights')}>Switch</button>
    }
    render(
      <>
        <Harness screen="other" />
        <Switching />
      </>,
    )
    await wait(700)
    press('Switch')
    await wait(700)
    expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
  })

  it('a failed save never breaks the walkthrough', async () => {
    net.saveFails = true
    render(<Harness role="knowledge_admin" />)
    act(() => play(['accounts']))
    await wait(200)
    press('Finish')
    await wait(50)
    expect(useWalkthroughs.getState().record.seen.accounts.state).toBe('played')
  })
})

describe('the practice assessment', () => {
  it('a hands-on walkthrough offered on a real assessment opens the practice one first', async () => {
    window.history.replaceState(null, '', '/assessment?ref=RPT-2026-0239&tab=observations')
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    await wait(700)
    press('Show me')
    expect(window.location.pathname + window.location.search).toBe(PRACTICE_PLACE)
  })

  it('without one, its offer is held back (not declined), and a replay sets it up again first', async () => {
    render(<Harness screen="observations" />)
    await wait(700)
    expect(screen.queryByText('Hands offer.')).toBeNull()
    expect(net.patches).toEqual([])
    act(() => play(['observations']))
    await wait(100)
    expect(toast.info).toHaveBeenCalledWith('Practice assessment set up again')
    expect(useWalkthroughs.getState().record.practice).toBe('PRACTICE-0001')
  })

  it('a target missing on the practice assessment resets it and plays again, once', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    const resets = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/walkthroughs/practice').length
    act(() => play(['used-up']))
    await wait(4300)
    expect(resets()).toBe(1)
    expect(toast.info).toHaveBeenCalledWith('Practice assessment reset')
    expect(screen.queryByText(plain(LOST))).toBeNull()
    await wait(4300)
    expect(resets()).toBe(1)
    expect(screen.getByText(plain(LOST))).toBeTruthy()
  })

  it('ends with the fixed message when it cannot be set up', async () => {
    net.practiceFails = true
    render(<Harness screen="observations" />)
    act(() => play(['observations']))
    await wait(100)
    expect(screen.getByText(plain(LOST))).toBeTruthy()
  })
})

describe('an answer that takes too long', () => {
  it('says the try-it’s own line, ends recorded as played, and plays nothing queued after it', async () => {
    window.history.replaceState(null, '', PRACTICE_PLACE)
    render(<Harness screen="observations" record={{ practice: 'PRACTICE-0001' }} />)
    act(() => play(['observations', 'clients']))
    await wait(200)
    press('Add')
    await wait(1600)
    expect(screen.getByText('Taking longer.')).toBeTruthy()
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(net.patches).toContainEqual({ seen: { observations: 'played' } })
    press('OK')
    await wait(400)
    expect(useWalkthroughs.getState().running).toBeNull()
  })
})
