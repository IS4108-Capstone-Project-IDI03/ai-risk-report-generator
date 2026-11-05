// The engineer's position, once or live, and their nearest block (CP-26). Used
// by components/MyLocationButton.tsx and FindMyBlock.tsx. Calls the browser's
// location service, which needs HTTPS or localhost. Nothing here stores a position.
import type { Coordinates } from './googleMaps'

// How far a block can be and still count, and the roughest position worth
// using: a laptop on Wi-Fi can be a kilometre out. GPS drifts tens of metres
// indoors, so this finds a block, never a room.
export const BLOCK_RANGE_METRES = 300

// How far the engineer moves before their address is looked up again. Google
// bills each lookup, and GPS updates every second or so.
export const ADDRESS_STEP_METRES = 50

const EARTH_RADIUS_METRES = 6_371_000
const radians = (degrees: number) => (degrees * Math.PI) / 180

/** Returns the distance between two points along the ground (the haversine formula). */
export function distanceMetres(a: Coordinates, b: Coordinates) {
  const latGap = radians(b.lat - a.lat)
  const lngGap = radians(b.lng - a.lng)
  const h =
    Math.sin(latGap / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngGap / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h))
}

/** Returns the closest pin within range, or null. */
export function nearestBlock<T extends Coordinates>(me: Coordinates, pins: T[]): T | null {
  const inRange = pins
    .map((pin) => ({ pin, metres: distanceMetres(me, pin) }))
    .filter((p) => p.metres <= BLOCK_RANGE_METRES)
    .sort((a, b) => a.metres - b.metres)
  return inRange[0]?.pin ?? null
}

export type MyPosition = { point: Coordinates; accuracy: number }

const NO_LOCATION = 'This browser doesn’t share its location.'
// A fresh, GPS-grade fix, given up on after 15 s so the button can't hang.
const FRESH_FIX = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }

const positionOf = ({ coords }: GeolocationPosition): MyPosition => ({
  point: { lat: coords.latitude, lng: coords.longitude },
  accuracy: coords.accuracy,
})
const problemOf = (error: GeolocationPositionError) =>
  error.code === error.PERMISSION_DENIED
    ? 'Allow location for this site in your browser, then try again.'
    : 'We couldn’t find you. Try again outside.'

/** Returns where the browser says the engineer is; rejects with words to show them. */
export function currentPosition() {
  return new Promise<MyPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(NO_LOCATION))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(positionOf(position)),
      (error) => reject(new Error(problemOf(error))),
      // A reading up to 30 s old is still where they are, and indoors a brand
      // new one often never comes.
      { ...FRESH_FIX, maximumAge: 30_000 },
    )
  })
}

/**
 * Follows the engineer until the returned function is called. A lost signal is
 * reported and the browser keeps trying; `ended` says tracking can't go on.
 */
export function trackPosition(
  onMove: (position: MyPosition) => void,
  onProblem: (message: string, ended: boolean) => void,
) {
  if (!navigator.geolocation) {
    onProblem(NO_LOCATION, true)
    return () => undefined
  }
  const watch = navigator.geolocation.watchPosition(
    (position) => onMove(positionOf(position)),
    (error) => onProblem(problemOf(error), error.code === error.PERMISSION_DENIED),
    FRESH_FIX,
  )
  return () => navigator.geolocation.clearWatch(watch)
}
