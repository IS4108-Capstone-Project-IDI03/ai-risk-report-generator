import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { signIn } from './test/session'
import { chooseOption } from './design-system/components/forms/selectTestHelpers'
import { created, gateway, json } from './features/new-assessment/testKit'

beforeAll(() => {
  // jsdom has no native modal implementation; browser supplies focus trapping.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
// Four assessments on the engineer's list, as the gateway sends them.
const row = (reference: string, site: string) => created(reference, site)
const LIST = [
  row('RPT-2026-0411', 'Tilbury Distribution Centre'),
  row('RPT-2026-0408', 'Leeds Cold Store'),
  row('RPT-2026-0402', 'Rotterdam Plant 2'),
  row('RPT-2026-0331', 'Bilbao Terminal'),
]
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'))
beforeEach(() => {
  gateway({
    'GET /api/assessments': () => json(200, LIST),
    'GET /api/notifications/count': () =>
      json(200, { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null }),
    'POST /api/assessments': unreachable,
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function openAssessment() {
  fireEvent.click(
    (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
  )
}
function tab(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

describe('Marsh prototype integration', () => {
  it('starts at sign-in, validates, enters the dashboard, and resets on sign-out', async () => {
    const view = render(<App />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the required fields')
    await signIn()
    expect(screen.getByRole('heading', { name: 'Assessments' })).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Search site, client or report ID')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await signIn()
    view.unmount()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
  it('opens the real reset flow from sign-in', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
  it('filters the dashboard, and creates nothing without the gateway', async () => {
    render(<App />)
    await signIn()
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value: 'does-not-exist' },
    })
    // The table footer counts the rows shown (CP-23).
    expect(screen.getByText('0 assessments')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Fill in the form/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByText('Add the site name')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Client name/), { target: { value: 'Demo Client' } })
    fireEvent.change(screen.getByLabelText(/^Site name/), { target: { value: 'Demo Warehouse' } })
    chooseOption(/^Facility type/, 'Distribution warehouse')
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: '1 Demo Road' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    // CP-23 dropped the demo-only assessment: without the gateway nothing is created.
    expect(await screen.findByText('Nothing created')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Assessments/ }))
    expect(await screen.findByText('4 assessments')).toBeInTheDocument()
  })
  it('lists the last three assessments opened under Recent, newest first', async () => {
    render(<App />)
    await signIn()
    const recent = () =>
      within(screen.getByRole('group', { name: 'Recent' }))
        .getAllByRole('button')
        .map((b) => b.textContent)
    // Nothing is listed until an assessment is opened.
    expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument()
    const openFromList = (id: string) => {
      fireEvent.click(screen.getByRole('button', { name: /^Assessments/ }))
      fireEvent.click(document.querySelector(`[data-id="${id}"]`)!)
    }
    openFromList('RPT-2026-0411')
    openFromList('RPT-2026-0408')
    openFromList('RPT-2026-0402')
    openFromList('RPT-2026-0331')
    // The fourth pushes the oldest out.
    expect(recent()).toEqual(['Bilbao Terminal', 'Rotterdam Plant 2', 'Leeds Cold Store'])
    // The open one is highlighted; another opens from Recent and moves first.
    expect(screen.getByRole('button', { name: 'Bilbao Terminal' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Leeds Cold Store' }))
    expect(screen.getByRole('heading', { name: 'Leeds Cold Store' })).toBeInTheDocument()
    expect(recent()).toEqual(['Leeds Cold Store', 'Bilbao Terminal', 'Rotterdam Plant 2'])
  })
  it('collapses the sidebar to a rail of labelled icons, and expands it again (CP-23)', async () => {
    render(<App />)
    await signIn()
    const nav = () => screen.getAllByRole('navigation')[0]
    await openAssessment()
    // Recent folds away under its heading.
    const recent = () => within(nav()).getByRole('group', { name: 'Recent' })
    expect(within(recent()).getAllByRole('button')).toHaveLength(1)
    fireEvent.click(within(nav()).getByRole('button', { name: 'Recent' }))
    expect(within(recent()).queryAllByRole('button')).toHaveLength(0)

    fireEvent.click(within(nav()).getByRole('button', { name: 'Collapse sidebar' }))
    // Every place stays, as an icon named by its label, with the label as a tooltip.
    expect(within(nav()).queryByText('Clients')).not.toBeInTheDocument()
    const clients = within(nav()).getByRole('button', { name: 'Clients' })
    act(() => clients.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Clients')
    expect(within(nav()).getByRole('button', { name: /^Assessments/ })).toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    // Recent is left off the rail.
    expect(within(nav()).queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument()

    fireEvent.click(within(nav()).getByRole('button', { name: 'Expand sidebar' }))
    expect(within(nav()).getByText('Clients')).toBeInTheDocument()
    expect(within(nav()).getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
  })
  it('saves observations and displays them in the assessment', async () => {
    const REF = 'RPT-2026-0411'
    const base = `/api/assessments/${REF}`
    // The gateway keeps what is saved and lists it back, as the real one does.
    let saved: unknown[] = []
    const listSaved = () => json(200, saved)
    gateway({
      'GET /api/assessments': () => json(200, LIST),
      'GET /api/notifications/count': () =>
        json(200, { total: 0, unread: 0, inboxTodo: 0, newestInbox: null, newestBell: null }),
      [`POST ${base}/capture-session`]: () =>
        json(201, {
          session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
          assessment: {
            id: 'a1',
            reference: REF,
            client: 'Harbourline Properties',
            site: { code: 'SITE-9', name: 'Tilbury Distribution Centre' },
          },
        }),
      [`GET ${base}/locations`]: () =>
        json(200, [
          { id: 'l0', building: 'Warehouse', floor: 'Ground', name: 'Bay 3 — north aisle' },
          { id: 'l1', building: null, floor: null, name: 'Pump house' },
          { id: 'l2', building: null, floor: null, name: 'External yard' },
        ]),
      [`GET ${base}/observations`]: listSaved,
      [`GET ${base}/observations?include=deleted`]: listSaved,
      [`POST ${base}/observations`]: () => {
        const item = {
          id: 'o1',
          engineer: 'Alex Rowe',
          copeDimensions: null,
          standard: null,
          severity: 'moderate',
          location: { id: 'l1', building: null, floor: null, name: 'Pump house' },
          note: 'Demo sprinkler observation',
          recordings: [],
          photos: [],
          removedRecordings: [],
          removedPhotos: [],
          interpretation: null,
          recordedAt: '2026-09-29T08:10:00.000Z',
          edited: null,
          deleted: null,
        }
        saved = [item]
        return json(201, item)
      },
    })
    render(<App />)
    await signIn()
    // Open the assessment from the work list; Add manually is on its Observations tab.
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /^Tilbury Distribution Centre/ }))[0],
    )
    fireEvent.click(await screen.findByRole('tab', { name: /Observations/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add observation' }))
    fireEvent.click(screen.getByRole('button', { name: /^Add observation manually/ }))
    // Capture starts by choosing where the engineer is: by building, or
    // elsewhere on site (CP-16).
    fireEvent.click(await screen.findByRole('button', { name: /^Elsewhere on site, / }))
    fireEvent.click(screen.getByRole('button', { name: /^Elsewhere on site › Pump house/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(
      await screen.findByText('Add a note, recording, photograph or page first.'),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Demo sprinkler observation' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Moderate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    // The back button above the form goes to the assessment's Observations tab.
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Observations' }))
    expect(screen.queryByRole('button', { name: 'Save observation' })).not.toBeInTheDocument()
    expect(await screen.findByText('Demo sprinkler observation')).toBeInTheDocument()
  })
  it.each([390, 900])('provides usable navigation at %ipx', async (width) => {
    const previous = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(<App />)
    await signIn()
    if (width < 768) {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
      const drawer = screen.getByRole('dialog', { name: 'Navigation' })
      expect(within(drawer).queryByRole('heading', { name: 'Navigation' })).not.toBeInTheDocument()
      // No × button: Esc closes it.
      expect(within(drawer).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
      fireEvent(drawer, new Event('cancel', { cancelable: true }))
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
      // The drawer navigates, then closes.
      const reopened = screen.getByRole('dialog', { name: 'Navigation' })
      fireEvent.click(within(reopened).getByRole('button', { name: /^Assessments/ }))
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    }
    await openAssessment()
    expect(
      await screen.findByRole('heading', { name: 'Tilbury Distribution Centre' }),
    ).toBeInTheDocument()
    tab(/^Review/)
    expect(screen.getByRole('tab', { name: /^Review/ })).toHaveAttribute('aria-selected', 'true')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous })
  })
})
