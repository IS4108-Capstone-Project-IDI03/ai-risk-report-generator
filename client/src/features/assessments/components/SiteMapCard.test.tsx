// The Overview's site map (CP-26): Google is faked, so a test clicks the map
// by calling the listener the card gave it.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleMaps } from '../googleMaps'
import { SiteMapCard } from './SiteMapCard'

vi.mock('../googleMaps', async (original) => ({
  ...(await original<typeof import('../googleMaps')>()),
  loadGoogleMaps: vi.fn(),
}))

type Listener = (event: { latLng: { lat: () => number; lng: () => number } }) => void
let mapClick: Listener | undefined
let markers: {
  title: string
  label: string
  click?: () => void
  setMap: ReturnType<typeof vi.fn>
}[]

function fakeMaps() {
  markers = []
  return {
    Map: class {
      addListener = (_: string, listener: Listener) => (mapClick = listener)
      setCenter = vi.fn()
      setZoom = vi.fn()
      fitBounds = vi.fn()
    },
    Marker: class {
      setMap = vi.fn()
      title: string
      label: string
      click?: () => void
      constructor(options: { title: string; label: string }) {
        this.title = options.title
        this.label = options.label
        markers.push(this)
      }
      addListener(_: string, listener: () => void) {
        this.click = listener
      }
    },
    LatLngBounds: class {
      extend = vi.fn()
    },
  }
}

const clickMap = (lat: number, lng: number) =>
  act(async () => mapClick!({ latLng: { lat: () => lat, lng: () => lng } }))
const SITE = { id: 's1', coordinates: { lat: 1.3, lng: 103.8 }, pins: [] }
const put = vi.fn()

function open(props: Partial<Parameters<typeof SiteMapCard>[0]> = {}) {
  const onSaved = vi.fn()
  render(<SiteMapCard site={SITE} buildings={[]} canEdit onSaved={onSaved} {...props} />)
  return { onSaved }
}
const row = (name: string) => within(screen.getByRole('listitem', { name }))
const sentMap = () => JSON.parse(put.mock.calls.at(-1)![1].body)

beforeEach(() => {
  // Each test's card makes its own map, so an old listener must not linger.
  mapClick = undefined
  vi.mocked(loadGoogleMaps).mockResolvedValue(fakeMaps() as never)
  put.mockReset()
  put.mockImplementation(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => put(url, init))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the site pin', () => {
  it('shows the site and block pins on the map, labelled (AC5)', async () => {
    open({ site: { ...SITE, pins: [{ name: 'Block A', lat: 1.31, lng: 103.81 }] } })
    await vi.waitFor(() => expect(markers).toHaveLength(2))
    expect(markers.map((m) => [m.label, m.title])).toEqual([
      ['S', 'Site'],
      ['1', 'Block A'],
    ])
  })

  it('adds a location to a site with none by clicking the map (AC6)', async () => {
    const { onSaved } = open({ site: { ...SITE, coordinates: null } })
    fireEvent.click(screen.getByRole('button', { name: 'Add site location' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.5, 103.5)
    expect(put.mock.calls[0][0]).toBe('/api/sites/s1/map')
    expect(sentMap()).toEqual({ coordinates: { lat: 1.5, lng: 103.5 } })
    expect(onSaved).toHaveBeenCalledWith('Geolocation saved')
  })

  it('takes pasted coordinates instead, and says what is wrong with bad ones (AC2, AC3)', async () => {
    open({ site: { ...SITE, coordinates: null } })
    fireEvent.click(screen.getByRole('button', { name: 'Add site location' }))
    const field = screen.getByLabelText('Coordinates')
    fireEvent.change(field, { target: { value: '91, 103' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(await screen.findByText(/latitude from -90 to 90/)).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '1.2966, 103.852' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Set' })))
    expect(sentMap().coordinates).toEqual({ lat: 1.2966, lng: 103.852 })
  })

  it('removes the location (AC7)', async () => {
    open()
    await act(async () => fireEvent.click(row('Site').getByRole('button', { name: 'Remove' })))
    expect(sentMap()).toEqual({ coordinates: null })
  })

  it('ignores a map click while nothing is being placed', async () => {
    open()
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.5, 103.5)
    expect(put).not.toHaveBeenCalled()
  })
})

describe('directions (AC8)', () => {
  it('links each pinned row to Google Maps in a new tab', () => {
    open({ site: { ...SITE, pins: [{ name: 'Block A', lat: 1.31, lng: 103.81 }] } })
    const link = row('Block A').getByRole('link', { name: /Directions/ })
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=1.31,103.81',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('opens directions when a pin is clicked', async () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    open()
    await vi.waitFor(() => expect(markers).toHaveLength(1))
    markers[0].click!()
    expect(opened).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=1.3,103.8',
      '_blank',
      'noreferrer',
    )
  })
})

describe('block pins', () => {
  it('lists each building once, with its pin found ignoring case (AC9, AC11)', () => {
    open({
      buildings: ['Block A', 'Block B'],
      site: { ...SITE, pins: [{ name: 'BLOCK A', lat: 1.31, lng: 103.81 }] },
    })
    expect(row('BLOCK A').getByRole('link', { name: /Directions/ })).toBeInTheDocument()
    expect(row('Block B').getByText('Not pinned')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('pins a block by clicking the map (AC10)', async () => {
    open({ buildings: ['Block B'] })
    fireEvent.click(row('Block B').getByRole('button', { name: 'Pin' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.32, 103.82)
    expect(sentMap()).toEqual({ block: 'Block B', point: { lat: 1.32, lng: 103.82 } })
  })

  it('moves a block without adding a second pin (AC10)', async () => {
    open({
      buildings: ['Block A'],
      site: { ...SITE, pins: [{ name: 'Block A', lat: 1.31, lng: 103.81 }] },
    })
    fireEvent.click(row('Block A').getByRole('button', { name: 'Move' }))
    await vi.waitFor(() => expect(mapClick).toBeDefined())
    await clickMap(1.33, 103.83)
    expect(sentMap()).toEqual({ block: 'Block A', point: { lat: 1.33, lng: 103.83 } })
  })

  it('removes a block pin (AC10)', async () => {
    open({
      buildings: ['Block A'],
      site: { ...SITE, pins: [{ name: 'Block A', lat: 1.31, lng: 103.81 }] },
    })
    await act(async () => fireEvent.click(row('Block A').getByRole('button', { name: 'Remove' })))
    expect(sentMap()).toEqual({ block: 'Block A', point: null })
  })
})

describe('while placing a pin', () => {
  it('takes a click on a pin as that spot, not directions', async () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    open({ buildings: ['Block B'] })
    fireEvent.click(row('Block B').getByRole('button', { name: 'Pin' }))
    await vi.waitFor(() => expect(markers).toHaveLength(1))
    await act(async () => markers[0].click!())
    expect(opened).not.toHaveBeenCalled()
    expect(sentMap()).toEqual({ block: 'Block B', point: SITE.coordinates })
  })

  it('clears a typing mistake on Cancel', async () => {
    open()
    fireEvent.click(row('Site').getByRole('button', { name: 'Move' }))
    fireEvent.change(screen.getByLabelText('Coordinates'), { target: { value: 'north' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the buttons off until the card has the saved pin', async () => {
    let refreshed = () => {}
    const onSaved = () => new Promise<void>((done) => (refreshed = done))
    open({ onSaved })
    await act(async () => fireEvent.click(row('Site').getByRole('button', { name: 'Remove' })))
    expect(row('Site').getByRole('button', { name: 'Move' })).toBeDisabled()
    await act(async () => refreshed())
    expect(row('Site').getByRole('button', { name: 'Move' })).toBeEnabled()
  })
})

describe('limits', () => {
  it('shows the map and directions but no changes to someone who may not edit (AC12)', () => {
    open({ canEdit: false, buildings: ['Block A'] })
    expect(row('Site').getByRole('link', { name: /Directions/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move|Pin|Remove/ })).not.toBeInTheDocument()
  })

  it('says when the map is unavailable, keeping directions and pasted coordinates (AC13)', async () => {
    vi.mocked(loadGoogleMaps).mockResolvedValue(null)
    open()
    expect(await screen.findByText(/map isn’t available/)).toBeInTheDocument()
    expect(row('Site').getByRole('link', { name: /Directions/ })).toBeInTheDocument()
    fireEvent.click(row('Site').getByRole('button', { name: 'Move' }))
    expect(screen.getByLabelText('Coordinates')).toBeInTheDocument()
  })

  it('says why a save failed and keeps the map as it was', async () => {
    put.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'This site has been removed.' }), { status: 409 }),
    )
    const { onSaved } = open()
    await act(async () => fireEvent.click(row('Site').getByRole('button', { name: 'Remove' })))
    expect(await screen.findByText('This site has been removed.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
