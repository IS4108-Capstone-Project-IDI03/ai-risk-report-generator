// Tests for Settings > Walkthroughs (F-12). The engine's actions and the toast are stubbed, and the
// groups are the test's own, so none of this depends on the 36 real definitions or a gateway.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUIET_WALKTHROUGHS } from '../../test/session'
import type { UserRole } from '../accounts/api'
import { useWalkthroughs } from '../walkthrough/engine'
import type { WalkthroughRecord } from '../walkthrough/types'
import { TIER_IDS } from './tiers'
import type { Settings as SettingsData } from './api'
import { Settings } from './Settings'

const engine = vi.hoisted(() => ({
  play: vi.fn(),
  setOffers: vi.fn(async () => undefined),
  offerAllAgain: vi.fn(async () => undefined),
  setUpPractice: vi.fn(async () => 'PRACTICE-0002'),
  removePractice: vi.fn(async () => undefined),
  openPractice: vi.fn(),
}))
vi.mock('../walkthrough/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../walkthrough/engine')>()),
  ...engine,
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../design-system')>()),
  toast: toasts,
}))
const GROUPS = [
  { name: 'Getting started', items: [{ id: 'welcome', name: 'A quick look around' }] },
  {
    name: 'Day to day',
    items: [
      { id: 'inbox', name: 'Use your Inbox' },
      { id: 'calendar', name: 'Read the Calendar' },
      { id: 'clients', name: 'Find a client' },
    ],
  },
]
const ADMIN_GROUP = {
  name: 'Admin tasks',
  items: [{ id: 'accounts', name: 'Manage user accounts' }],
}
vi.mock('../walkthrough/registry', () => ({
  DEFINITIONS: [],
  groupsFor: (role: UserRole) => (role === 'knowledge_admin' ? [...GROUPS, ADMIN_GROUP] : GROUPS),
}))

const settings: SettingsData = {
  canEditGlobal: false,
  noteTaking: { codes: { fact: 'F', info_request: 'IR', recommendation: 'REC' }, glossary: [] },
  models: [],
  qaStrictness: 'standard',
  sourcePriority: { order: [...TIER_IDS], history: [] },
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(settings)))),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// Opens Settings > Walkthroughs signed in as `role` with this record.
async function openIt(role: UserRole = 'risk_engineer', record: Partial<WalkthroughRecord> = {}) {
  useWalkthroughs.setState({
    role,
    record: { ...QUIET_WALKTHROUGHS, offers: true, practice: 'PRACTICE-0001', ...record },
  })
  render(<Settings />)
  fireEvent.click(await screen.findByRole('button', { name: 'Walkthroughs' }))
}
const group = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }))
const dialog = () => screen.getByRole('dialog')

describe('Settings > Walkthroughs', () => {
  it('puts Walkthroughs last in the personal group, for both roles', async () => {
    for (const role of ['risk_engineer', 'knowledge_admin'] as const) {
      await openIt(role)
      const menu = screen.getByRole('navigation', { name: 'Settings sections' })
      const personal = within(menu.firstElementChild as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.textContent)
      expect(personal).toEqual(['Password', 'Chat and Voice', 'Note-Taking', 'Walkthroughs'])
      cleanup()
    }
  })

  it('greys out Play selected with its reason until something is ticked, then counts', async () => {
    await openIt()
    const play = screen.getByRole('button', { name: 'Play selected' })
    expect(play).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(play)
    expect(engine.play).not.toHaveBeenCalled()
    fireEvent.click(group('Day to day'))
    tick('Find a client')
    expect(screen.getByRole('button', { name: 'Play 1 walkthrough' })).not.toHaveAttribute(
      'aria-disabled',
    )
    tick('Use your Inbox')
    expect(screen.getByRole('button', { name: 'Play 2 walkthroughs' })).toBeInTheDocument()
  })

  it('plays the ticked ones in the order listed, not the order ticked', async () => {
    await openIt()
    fireEvent.click(group('Day to day'))
    tick('Find a client')
    tick('Select all in Getting started')
    tick('Use your Inbox')
    fireEvent.click(screen.getByRole('button', { name: 'Play 3 walkthroughs' }))
    expect(engine.play).toHaveBeenCalledWith(['welcome', 'inbox', 'clients'])
  })

  it('plays one walkthrough from its own round button', async () => {
    await openIt()
    fireEvent.click(group('Day to day'))
    fireEvent.click(screen.getByRole('button', { name: 'Play Read the Calendar' }))
    expect(engine.play).toHaveBeenCalledWith(['calendar'])
  })

  it('marks a played walkthrough, and only that one', async () => {
    await openIt('risk_engineer', {
      seen: {
        inbox: { state: 'played', at: '2026-01-01T00:00:00.000Z' },
        calendar: { state: 'skipped', at: '2026-01-01T00:00:00.000Z' },
      },
    })
    fireEvent.click(group('Day to day'))
    const marks = screen.getAllByRole('img', { name: 'Played' })
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('li')).toHaveTextContent('Use your Inbox')
  })

  it('saves the offers switch', async () => {
    await openIt()
    const offers = screen.getByRole('switch', { name: 'Offer walkthroughs on new screens' })
    expect(offers).toBeChecked()
    fireEvent.click(offers)
    expect(engine.setOffers).toHaveBeenCalledWith(false)
  })

  it('asks before offering everything again, then clears and shows a toast', async () => {
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Offer all walkthroughs again' }))
    expect(within(dialog()).getByText('Offer every walkthrough again?')).toBeInTheDocument()
    expect(engine.offerAllAgain).not.toHaveBeenCalled()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(engine.offerAllAgain).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Offer all walkthroughs again' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Offer again' }))
    await waitFor(() => expect(engine.offerAllAgain).toHaveBeenCalledOnce())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledOnce())
  })

  it('opens the practice assessment', async () => {
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Open practice assessment' }))
    expect(engine.openPractice).toHaveBeenCalledOnce()
  })

  it('asks before resetting, then makes a fresh one and shows a toast', async () => {
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Reset practice assessment' }))
    expect(engine.setUpPractice).not.toHaveBeenCalled()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(engine.setUpPractice).toHaveBeenCalledOnce())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledOnce())
  })

  it('asks before removing, then removes it and shows a toast', async () => {
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Remove practice assessment' }))
    expect(engine.removePractice).not.toHaveBeenCalled()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(engine.removePractice).toHaveBeenCalledOnce())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledOnce())
  })

  it('leaves the row as it was and shows an error toast when a remove fails', async () => {
    engine.removePractice.mockRejectedValueOnce(new Error('down'))
    await openIt()
    fireEvent.click(screen.getByRole('button', { name: 'Remove practice assessment' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Open practice assessment' })).toBeInTheDocument()
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('reads Removed with a Set it up again button once the practice is gone', async () => {
    await openIt('risk_engineer', { practice: null })
    expect(
      screen.getByText("You've removed it, but you can set it up again at any time."),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open practice assessment' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set it up again' }))
    await waitFor(() => expect(engine.setUpPractice).toHaveBeenCalledOnce())
    await waitFor(() => expect(toasts.success).toHaveBeenCalledOnce())
  })

  it('shows an admin the admin group too, and an engineer not', async () => {
    await openIt('knowledge_admin')
    expect(group('Admin tasks')).toBeInTheDocument()
    cleanup()
    await openIt('risk_engineer')
    expect(screen.queryByRole('button', { name: /^Admin tasks/ })).toBeNull()
    await act(async () => undefined)
  })
})
