// Finding the engineer and their nearest block (CP-26). The browser's location is faked.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPosition, distanceMetres, nearestBlock } from './myLocation'

const ME = { lat: 1.2966, lng: 103.852 }
// About 111 m per 0.001 degree of latitude.
const north = (metres: number) => ({ lat: ME.lat + metres / 111_195, lng: ME.lng })

it('measures the distance between two points', () => {
  expect(distanceMetres(ME, north(1000))).toBeCloseTo(1000, 0)
})

describe('nearestBlock (CP-26 AC14, AC16)', () => {
  const pin = (name: string, metres: number) => ({ name, ...north(metres) })

  it('finds the closest pin within 300 m', () => {
    expect(nearestBlock(ME, [pin('Far', 250), pin('Near', 40)])?.name).toBe('Near')
  })

  it('finds none past 300 m, or with no pins', () => {
    expect(nearestBlock(ME, [pin('Far', 301)])).toBeNull()
    expect(nearestBlock(ME, [])).toBeNull()
  })
})

describe('currentPosition (CP-26 AC20)', () => {
  const browser = (getCurrentPosition: unknown) =>
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  afterEach(() => vi.unstubAllGlobals())

  it('gives the point and how accurate it is', async () => {
    browser((done: (p: unknown) => void) =>
      done({ coords: { latitude: 1.3, longitude: 103.8, accuracy: 12 } }),
    )
    await expect(currentPosition()).resolves.toEqual({
      point: { lat: 1.3, lng: 103.8 },
      accuracy: 12,
    })
  })

  it.each([
    [1, /Allow location/],
    [2, /couldn’t find/],
    [3, /couldn’t find/],
  ])('says how to carry on after browser error %i', async (code, message) => {
    browser((_: unknown, failed: (e: unknown) => void) => failed({ code, PERMISSION_DENIED: 1 }))
    await expect(currentPosition()).rejects.toThrow(message)
  })

  it('says so when the browser has no location at all', async () => {
    vi.stubGlobal('navigator', {})
    await expect(currentPosition()).rejects.toThrow(/doesn’t share/)
  })
})
