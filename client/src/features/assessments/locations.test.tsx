import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { SiteLocation } from './api'

const REF = 'RPT-2026-0411'
const LOCATIONS_URL = `/api/assessments/${REF}/locations`
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-29T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A small stand-in for the gateway. Added locations are kept, as it does.
let stored: SiteLocation[] = []
let observations: unknown[] = []
let removeReply: () => Promise<Response> = () =>
  Promise.resolve(new Response(null, { status: 204 }))
const added: Record<string, unknown>[] = []
const removed: string[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (url === `/api/assessments/${REF}/capture-session`) return json(201, CAPTURE)
    if (url === `/api/assessments/${REF}/observations`) return json(200, observations)
    if (url.startsWith(LOCATIONS_URL + '/') && init.method === 'DELETE') {
      removed.push(url.slice(LOCATIONS_URL.length + 1))
      return removeReply()
    }
    if (url === LOCATIONS_URL && init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const key = (l: { name: string; floor?: string | null }) =>
        (l.name + '|' + (l.floor ?? '')).toLowerCase()
      if (stored.some((l) => key(l) === key(body))) {
        const error = 'This location is already on the list.'
        return json(409, { error, fields: { name: error } })
      }
      added.push(body)
      const location = {
        id: 'l' + (stored.length + 1),
        name: body.name,
        floor: body.floor || null,
      }
      stored = [...stored, location]
      return json(201, location)
    }
    if (url === LOCATIONS_URL) return json(200, stored)
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

async function openCapture() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
  await screen.findByText('Capture session started')
}
const sheet = () => screen.getByRole('dialog', { name: 'Where are you?' })
function addLocation(name: string, floor = '') {
  fireEvent.change(within(sheet()).getByRole('textbox', { name: /^Name/ }), {
    target: { value: name },
  })
  fireEvent.change(within(sheet()).getByRole('textbox', { name: /^Floor/ }), {
    target: { value: floor },
  })
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Add location' }))
}
const locationBar = () => screen.getByRole('button', { name: /^(Location:|Choose a location)/ })

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  stored = []
  observations = []
  removeReply = () => Promise.resolve(new Response(null, { status: 204 }))
  added.length = 0
  removed.length = 0
  vi.stubGlobal('confirm', () => true)
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Choosing where observations are captured', () => {
  it('starts capture by adding a location, then captures in it', async () => {
    await openCapture()

    // With no locations yet, the sheet opens on the form to add one.
    expect(await screen.findByRole('dialog', { name: 'Where are you?' })).toBeInTheDocument()
    addLocation('Stairwell B', 'Level 2')

    expect(await screen.findByRole('button', { name: /Location: Stairwell B · Level 2/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(added).toEqual([{ name: 'Stairwell B', floor: 'Level 2' }])
  })

  it('switches to another location, or adds one, from the location bar', async () => {
    stored = [
      { id: 'l1', name: 'Stairwell B', floor: 'Level 2' },
      { id: 'l2', name: 'Pump house', floor: null },
    ]
    await openCapture()
    fireEvent.click(await screen.findByRole('button', { name: /^Stairwell B · Level 2/ }))

    fireEvent.click(locationBar())
    fireEvent.click(within(sheet()).getByRole('button', { name: /^Pump house/ }))
    expect(locationBar()).toHaveAccessibleName(/Location: Pump house/)

    fireEvent.click(locationBar())
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add a location' }))
    addLocation('Lift A', 'Ground')
    expect(await screen.findByRole('button', { name: /Location: Lift A · Ground/ }))
  })

  it('filters the list by search and starts a new location from it', async () => {
    stored = [
      { id: 'l1', name: 'Stairwell B', floor: 'Level 2' },
      { id: 'l2', name: 'Loading bay 4', floor: null },
    ]
    await openCapture()
    await screen.findByRole('button', { name: /^Stairwell B/ })

    fireEvent.change(within(sheet()).getByRole('searchbox', { name: /Search locations/ }), {
      target: { value: 'load' },
    })

    const list = within(sheet()).getByRole('list', { name: 'Locations' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Loading bay 4'])
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add a location' }))
    // The search becomes the new location's name.
    expect(within(sheet()).getByRole('textbox', { name: /^Name/ })).toHaveValue('load')
  })

  it('refuses a location already on the list, whatever the case', async () => {
    stored = [{ id: 'l1', name: 'Stairwell B', floor: 'Level 2' }]
    await openCapture()
    await screen.findByRole('button', { name: /^Stairwell B/ })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add a location' }))

    addLocation('stairwell b', 'LEVEL 2')

    // The gateway refuses it, and says why under the name.
    expect(await within(sheet()).findByText('This location is already on the list.'))
    expect(added).toEqual([])
    expect(within(sheet()).getByRole('textbox', { name: /^Name/ })).toHaveValue('stairwell b')
  })

  it('lets the engineer leave capture before choosing a location', async () => {
    await openCapture()
    await screen.findByRole('dialog', { name: 'Where are you?' })

    fireEvent.click(within(sheet()).getByRole('button', { name: 'Leave capture' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
  })

  it('removes a location added by mistake, but not one with observations', async () => {
    stored = [
      { id: 'l1', name: 'Stairwel B', floor: null },
      { id: 'l2', name: 'Boiler room', floor: null },
    ]
    observations = [
      {
        id: 'o1',
        engineer: 'A. Rowe',
        copeDimension: 'Protection',
        standard: null,
        severity: 'high',
        location: stored[1],
        note: 'Pump test certificate missing.',
        recordings: [],
        recordedAt: '2026-09-29T08:10:00.000Z',
      },
    ]
    await openCapture()
    await within(sheet()).findByText('1 observation')

    // Only the unused one offers removal.
    expect(within(sheet()).queryByRole('button', { name: 'Remove Boiler room' })).toBeNull()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove Stairwel B' }))

    await vi.waitFor(() => expect(within(sheet()).queryByText('Stairwel B')).toBeNull())
    expect(removed).toEqual(['l1'])
    expect(within(sheet()).getByText('Boiler room')).toBeInTheDocument()
  })

  it('keeps the location when removal is cancelled or refused', async () => {
    stored = [{ id: 'l1', name: 'Lift A', floor: 'Ground' }]
    await openCapture()
    await screen.findByRole('button', { name: /^Lift A · Ground/ })

    vi.stubGlobal('confirm', () => false)
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove Lift A · Ground' }))
    expect(removed).toEqual([])

    // Someone else saved an observation there in the meantime.
    vi.stubGlobal('confirm', () => true)
    removeReply = () =>
      json(409, {
        error: "Lift A has 1 observation. It can't be removed while they are saved there.",
      })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove Lift A · Ground' }))

    expect(await within(sheet()).findByRole('alert')).toHaveTextContent(
      "Lift A has 1 observation. It can't be removed while they are saved there.",
    )
    expect(within(sheet()).getByText('Lift A · Ground')).toBeInTheDocument()
  })

  it('asks for another location after removing the one in use', async () => {
    stored = [
      { id: 'l1', name: 'Lift A', floor: 'Ground' },
      { id: 'l2', name: 'Roof', floor: null },
    ]
    await openCapture()
    fireEvent.click(await screen.findByRole('button', { name: /^Lift A · Ground/ }))
    fireEvent.click(locationBar())

    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove Lift A · Ground' }))

    // No location is chosen now, so the sheet cannot be closed.
    await vi.waitFor(() =>
      expect(within(sheet()).queryByRole('button', { name: 'Close' })).toBeNull(),
    )
    expect(removed).toEqual(['l1'])
    expect(within(sheet()).getByRole('button', { name: 'Leave capture' })).toBeInTheDocument()
  })
})
