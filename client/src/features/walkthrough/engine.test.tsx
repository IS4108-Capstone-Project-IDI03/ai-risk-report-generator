// The walkthrough engine (F-12, test seam 3): offers, the Welcome, the settle rule, hands-on steps
// and the quiet wait for the app's answer, Skip and Finish, a queue, try-its, "other way" offers,
// roles and saving.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '../../design-system'
import { canPlay, play, setOffers, tryItRunning, useWalkthroughs } from './engine'
import { ALL_DONE, BUSY, LOST, tell } from './player'
import { onSignal, signal } from './signals'
import { TEST_DEFS } from './testDefinitions'
import { Harness, layOut } from './testKit'
import { useWalkthroughScreen } from './useWalkthroughScreen'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

const plain = (text: string) => text.replaceAll('**', '')
let patches: unknown[] = []
let checkOk = true
let saveFails = false
let practiceFails = false
const PRACTICE_PLACE = '/assessment?ref=PRACTICE-0001&tab=observations'

beforeEach(() => {
  vi.clearAllMocks()
  patches = []
  checkOk = true
  saveFails = false
  practiceFails = false
  layOut()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/walkthroughs/check')) return Response.json({ ok: checkOk })
      if (String(url) === '/api/walkthroughs/practice')
        return practiceFails
          ? new Response('{}', { status: 503 })
          : Response.json({ reference: 'PRACTICE-0001' })
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)).walkthroughs)
        return saveFails ? new Response('{}', { status: 500 }) : Response.json({})
      }
      return Response.json({})
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const offerText = TEST_DEFS[1].offer!.split('\n\n')[0]
const bar = () => screen.queryByText(/^Step \d+ of \d+$/)?.textContent

describe('offers', () => {
  it('offers a screen 600 ms after it is ready, the first time only', async () => {
    render(<Harness />)
    await wait(400)
    expect(screen.queryByText(new RegExp(offerText))).toBeNull()
    await wait(300)
    expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
  })

  it.each([
    ['played', { seen: { clients: { state: 'played' as const, at: '' } } }],
    ['declined', { seen: { clients: { state: 'declined' as const, at: '' } } }],
    ['skipped', { seen: { clients: { state: 'skipped' as const, at: '' } } }],
    ['switched off', { offers: false }],
  ])('offers nothing when %s', async (_, record) => {
    render(<Harness record={record} />)
    await wait(700)
    expect(screen.queryByText(new RegExp(offerText))).toBeNull()
  })

  it('Not now records declined; Show me starts the walkthrough', async () => {
    render(<Harness />)
    await wait(700)
    press('Not now')
    expect(patches).toEqual([{ seen: { clients: 'declined' } }])
    cleanup()
    render(<Harness />)
    await wait(700)
    press('Show me')
    await wait(200)
    expect(screen.getByText('Search here.')).toBeTruthy()
  })

  it('leaving the screen with an offer showing counts as Not now', async () => {
    render(<Harness />)
    await wait(700)
    press('Leave')
    expect(patches).toEqual([{ seen: { clients: 'declined' } }])
    await wait(200) // after its 150 ms fade
    expect(screen.queryByText(new RegExp(offerText))).toBeNull()
  })

  it('a role never sees another role’s walkthrough; a shared screen offers the first one', async () => {
    render(<Harness />)
    expect(canPlay('accounts')).toBe(false)
    expect(canPlay('clients')).toBe(true)
    cleanup()
    render(<Harness role="knowledge_admin" />)
    expect(canPlay('accounts')).toBe(true)
    await wait(700)
    expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
  })

  it('a try-it is not offered when its check fails; its own line says so instead', async () => {
    checkOk = false
    render(<Harness screen="chat" />)
    await wait(750)
    expect(screen.queryByText('Try asking?')).toBeNull()
    expect(screen.getByText("I'm sorry, I can't answer questions right now.")).toBeTruthy()
  })

  it('offers the other way once, after its signal', async () => {
    render(<Harness screen="form" />)
    await wait(700)
    act(() => signal('assessment-created'))
    await wait(700)
    expect(screen.getByText('Created! Would you like to see the other way?')).toBeTruthy()
    expect(patches).toContainEqual({ otherWay: ['clients'] })
    expect(patches).toContainEqual({ count: 'assessment-created' })
  })
})

it('a first-open offer wins; the other way waits for the next visit', async () => {
  render(<Harness />)
  act(() => signal('assessment-created'))
  await wait(700)
  expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
  press('Not now')
  press('Leave')
  await wait(700)
  expect(screen.getByText('Created! Would you like to see the other way?')).toBeTruthy()
})

describe('bare walkthroughs and nested screens', () => {
  it('a bare walkthrough shows by itself on first open, no question asked; OK records played', async () => {
    render(<Harness screen="menu" />)
    await wait(700)
    expect(screen.getByText('Two ways to start.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull()
    expect(useWalkthroughs.getState().dim).toBe(false)
    press('OK')
    expect(patches).toEqual([{ seen: { 'new-choice': 'played' } }])
  })

  it('leaving the screen with a bare walkthrough on show counts as played', async () => {
    render(<Harness screen="menu" />)
    await wait(700)
    press('Leave')
    expect(patches).toEqual([{ seen: { 'new-choice': 'played' } }])
    expect(useWalkthroughs.getState().running).toBeNull()
  })

  it('leaving an inner screen puts the outer one back, and its offer still comes', async () => {
    function Inner() {
      useWalkthroughScreen('inner', true)
      return null
    }
    function Both() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <Harness />
          {open && <Inner />}
          <button onClick={() => setOpen(false)}>Close menu</button>
        </>
      )
    }
    render(<Both />)
    await wait(700)
    expect(screen.queryByText(new RegExp(offerText))).toBeNull()
    press('Close menu')
    await wait(700)
    expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
  })
})

describe('the Welcome', () => {
  it.each(['risk_engineer', 'knowledge_admin'] as const)(
    'starts by itself on a first-time account (%s), with {name} filled in, and stamps welcome',
    async (role) => {
      render(<Harness role={role} record={{ welcomeAt: null }} />)
      await wait(100)
      const name = role === 'risk_engineer' ? 'Alex' : 'Sana'
      expect(screen.getByText(`Hi ${name}, welcome!`)).toBeTruthy()
      press('Skip for now')
      expect(patches).toEqual([{ seen: { welcome: 'skipped' }, welcome: true }])
    },
  )

  it('does not start once welcomeAt is set', async () => {
    render(<Harness />)
    await wait(100)
    expect(screen.queryByText(/welcome!/)).toBeNull()
  })

  it('uses the admin’s labels and plays to the end', async () => {
    render(<Harness role="knowledge_admin" record={{ welcomeAt: null }} />)
    await wait(50)
    press('Show me around')
    await wait(200)
    expect(screen.getByText('Your work lives here.')).toBeTruthy()
    press('Next')
    await wait(200)
    press('Go to Knowledge base')
    expect(patches).toEqual([{ seen: { welcome: 'played' }, welcome: true }])
  })
})

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
    expect(patches).toEqual([])
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
    expect(patches).toEqual([{ seen: { clients: 'skipped' } }])
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
    expect(patches).toEqual([{ seen: { accounts: 'played' } }])
    act(() => play(['clients']))
    await wait(200)
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(patches).toContainEqual({ seen: { clients: 'skipped' } })
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
    saveFails = true
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
    saveFails = true
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
    expect(patches).toEqual([])
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
    practiceFails = true
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
    expect(patches).toContainEqual({ seen: { observations: 'played' } })
    press('OK')
    await wait(400)
    expect(useWalkthroughs.getState().running).toBeNull()
  })
})

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

describe('a new session', () => {
  it('signing out and in as someone else carries nothing over', async () => {
    const { unmount } = render(<Harness />)
    act(() => play(['clients']))
    await wait(200)
    unmount()
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(useWalkthroughs.getState().record.offers).toBe(false)
    render(<Harness role="knowledge_admin" />)
    expect(useWalkthroughs.getState().role).toBe('knowledge_admin')
    await wait(700)
    expect(screen.getByText(new RegExp(offerText))).toBeTruthy()
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
    checkOk = false
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
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    expect(useWalkthroughs.getState()).toMatchObject({ bubble: null, quiet: true })
    expect(screen.getByRole('status').textContent).toBe("I'll carry on when this is ready.")
    await act(async () => vi.advanceTimersByTime(89_000))
    expect(useWalkthroughs.getState().bubble).toBeNull()
    await act(async () => vi.advanceTimersByTime(1_500))
    await wait(200)
    expect(screen.getByText('Want a sample?')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
    vi.useRealTimers()
  })

  it('a skip during the quiet wait clears its time limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => vi.advanceTimersByTime(91_000))
    await wait(200)
    // Nothing of the walkthrough comes back (the Clients screen's own first-open offer may show).
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(screen.queryByText('Want a sample?')).toBeNull()
    vi.useRealTimers()
  })

  it('leaving the screen during the quiet wait ends the walkthrough as a skip, with its Replay toast', async () => {
    render(<Harness />)
    act(() => play(['sample']))
    await wait(200)
    press('Use the sample')
    press('Leave') // one of the app's own links: no Back event
    await wait(400)
    expect(useWalkthroughs.getState().running).toBeNull()
    expect(patches).toContainEqual({ seen: { sample: 'skipped' } })
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
    // The person went there themselves within the first second.
    const late = document.createElement('button')
    late.setAttribute('data-walk', 't.late')
    document.body.append(late)
    await wait(1300)
    expect(pressed).not.toHaveBeenCalled()
    act(() => signal('read'))
    await wait(1300)
    expect(screen.getByText('Here it is.')).toBeTruthy()
    document.removeEventListener('click', onClick)
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
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => play(['observations']))
    await wait(200)
    press('Add')
    await wait(1300)
    expect(useWalkthroughs.getState().bubble).toBeNull() // waits for a new answer
  })
})

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
