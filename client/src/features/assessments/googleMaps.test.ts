// Coordinates, directions and loading Google's script (CP-26). The script is
// never really fetched: the test finishes it by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  directionsUrl,
  formatCoordinates,
  loadGoogleMaps,
  parseCoordinates,
  resetGoogleMaps,
  streetAddress,
} from './googleMaps'

describe('parseCoordinates (CP-26 AC2, AC3)', () => {
  it.each([
    ['1.2966, 103.8520', { lat: 1.2966, lng: 103.852 }],
    [' -33.86 151.21 ', { lat: -33.86, lng: 151.21 }],
    ['90,180', { lat: 90, lng: 180 }],
  ])('reads %s', (text, point) => {
    expect(parseCoordinates(text)).toEqual(point)
  })

  it.each(['', '1.29', 'north', '91, 103', '1, 181', '1, 2, 3'])('refuses %j', (text) => {
    expect(parseCoordinates(text)).toBeNull()
  })
})

it('shows coordinates to six places, which is about 10 cm', () => {
  expect(formatCoordinates({ lat: 1.29661234, lng: 103.852 })).toBe('1.296612, 103.852')
})

it('sends directions to the coordinates alone, so no client name reaches Google (CP-26 AC8)', () => {
  expect(directionsUrl({ lat: 1.2966, lng: 103.852 })).toBe(
    'https://www.google.com/maps/dir/?api=1&destination=1.2966,103.852',
  )
})

describe('loadGoogleMaps (CP-26 AC13)', () => {
  const script = () => document.head.querySelector<HTMLScriptElement>('script[data-google-maps]')
  const answerKey = (key: string | null) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ key }), { status: 200 }))
  const scriptAdded = () => vi.waitFor(() => expect(script()).not.toBeNull())

  beforeEach(resetGoogleMaps)
  afterEach(() => {
    script()?.remove()
    vi.unstubAllGlobals()
  })

  it('answers null with no key, and adds no script', async () => {
    answerKey(null)
    await expect(loadGoogleMaps()).resolves.toBeNull()
    expect(script()).toBeNull()
  })

  it('adds the script once, however many maps ask', async () => {
    answerKey('test-key')
    const first = loadGoogleMaps()
    const second = loadGoogleMaps()
    await scriptAdded()
    expect(script()!.src).toContain('key=test-key')
    const maps = { Map: vi.fn() }
    vi.stubGlobal('google', { maps })
    ;(window as unknown as { marshMapsReady: () => void }).marshMapsReady()
    await expect(first).resolves.toBe(maps)
    await expect(second).resolves.toBe(maps)
    expect(document.head.querySelectorAll('script[data-google-maps]')).toHaveLength(1)
  })

  it('answers null when the script fails, and tries again next time', async () => {
    answerKey('test-key')
    const failed = loadGoogleMaps()
    await scriptAdded()
    script()!.dispatchEvent(new Event('error'))
    await expect(failed).resolves.toBeNull()
    expect(script()).toBeNull()
    void loadGoogleMaps()
    await scriptAdded()
  })

  it('waits for Google to say it is ready, not just for the script to load', async () => {
    answerKey('test-key')
    let settled = false
    void loadGoogleMaps().then(() => (settled = true))
    await scriptAdded()
    script()!.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(settled).toBe(false)
  })

  it('remembers a refused key, so a map opened later says so too', async () => {
    answerKey('test-key')
    void loadGoogleMaps()
    await scriptAdded()
    ;(window as unknown as { gm_authFailure: () => void }).gm_authFailure()
    await expect(loadGoogleMaps()).resolves.toBeNull()
  })

  it('answers null when the gateway has no answer', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    await expect(loadGoogleMaps()).resolves.toBeNull()
  })
})

describe('streetAddress (CP-26 AC27)', () => {
  const SPOT = { lat: 1.2966, lng: 103.852 }
  const withGeocoder = async (geocode: () => Promise<unknown>) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ key: 'k' }), { status: 200 }))
    vi.stubGlobal('google', {
      maps: {
        Geocoder: function () {
          return { geocode }
        },
      },
    })
    const answer = streetAddress(SPOT)
    await vi.waitFor(() =>
      expect(document.head.querySelector('script[data-google-maps]')).not.toBeNull(),
    )
    ;(window as unknown as { marshMapsReady: () => void }).marshMapsReady()
    return answer
  }

  beforeEach(resetGoogleMaps)
  afterEach(() => {
    document.head.querySelector('script[data-google-maps]')?.remove()
    vi.unstubAllGlobals()
  })

  it('gives the nearest address Google has', async () => {
    const found = { results: [{ formatted_address: '10 Bayfront Avenue, Singapore' }] }
    await expect(withGeocoder(async () => found)).resolves.toBe('10 Bayfront Avenue, Singapore')
  })

  it('gives null when Google has none, so tracking carries on without it', async () => {
    await expect(withGeocoder(() => Promise.reject(new Error('ZERO_RESULTS')))).resolves.toBeNull()
  })
})
