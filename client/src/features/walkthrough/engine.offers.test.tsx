// The walkthrough engine (F-12, test seam 3): first-open offers and the "other way" offer, bare
// walkthroughs and nested screens, the Welcome, and a new session carrying nothing over.
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { canPlay, play, useWalkthroughs } from './engine'
import { signal } from './signals'
import { net, offerText, press, setUpEngineTests, wait } from './engineTestKit'
import { Harness } from './testKit'
import { useWalkthroughScreen } from './useWalkthroughScreen'

vi.mock('./registry', async () => ({ DEFINITIONS: (await import('./testDefinitions')).TEST_DEFS }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

setUpEngineTests()

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
    expect(net.patches).toEqual([{ seen: { clients: 'declined' } }])
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
    expect(net.patches).toEqual([{ seen: { clients: 'declined' } }])
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
    net.checkOk = false
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
    expect(net.patches).toContainEqual({ otherWay: ['clients'] })
    expect(net.patches).toContainEqual({ count: 'assessment-created' })
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
    expect(net.patches).toEqual([{ seen: { 'new-choice': 'played' } }])
  })

  it('leaving the screen with a bare walkthrough on show counts as played', async () => {
    render(<Harness screen="menu" />)
    await wait(700)
    press('Leave')
    expect(net.patches).toEqual([{ seen: { 'new-choice': 'played' } }])
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
      expect(net.patches).toEqual([{ seen: { welcome: 'skipped' }, welcome: true }])
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
    expect(net.patches).toEqual([{ seen: { welcome: 'played' }, welcome: true }])
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
