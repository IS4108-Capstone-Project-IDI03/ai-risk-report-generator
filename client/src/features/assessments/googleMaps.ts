// Google Maps for the site map (CP-26): reading coordinates, building a
// directions link, and loading Google's script. Used by SiteMapView, SiteMapCard
// and the New Assessment form. Calls GET /api/sites/map-config (site.routes.ts).
import { request } from './api'

export type Coordinates = { lat: number; lng: number }

// The little of Google's API this app uses, so no types package is needed.
type Listener<E> = (event: E) => void
export type GoogleMapInstance = {
  addListener(name: 'click', listener: Listener<{ latLng: { lat(): number; lng(): number } }>): void
  setCenter(point: Coordinates): void
  setZoom(zoom: number): void
  fitBounds(bounds: unknown): void
}
export type GoogleMarker = {
  addListener(name: 'click', listener: () => void): void
  setMap(map: GoogleMapInstance | null): void
}
export type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance
  Marker: new (options: Record<string, unknown>) => GoogleMarker
  LatLngBounds: new () => { extend(point: Coordinates): void }
}

const inRange = ({ lat, lng }: Coordinates) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** Returns the point in "1.2966, 103.8520" (comma or space between), or null if it isn't one. */
export function parseCoordinates(text: string): Coordinates | null {
  const found = /^\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/.exec(text)
  if (!found) return null
  const point = { lat: Number(found[1]), lng: Number(found[2]) }
  return inRange(point) ? point : null
}

// Six places is about 10 cm, far finer than a click on the map.
const rounded = (n: number) => Number(n.toFixed(6))

/** Returns the point as an engineer reads and pastes it. */
export const formatCoordinates = ({ lat, lng }: Coordinates) => `${rounded(lat)}, ${rounded(lng)}`

/** Returns the Google Maps link for directions, which needs no API key. */
export const directionsUrl = ({ lat, lng }: Coordinates) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

// Fired when Google refuses the key after the script loaded (a wrong key or
// domain), which it reports only through window.gm_authFailure.
export const MAPS_REFUSED_EVENT = 'marsh:maps-refused'

let loading: Promise<GoogleMaps | null> | null = null
// Google refused the key: remembered, so a map opened later says so too.
let refused = false

/** Forgets the script, so a test starts afresh. */
export function resetGoogleMaps() {
  loading = null
  refused = false
}

// Set on window for Google to call. Its script's load event is too early: the
// library is only ready when this runs, and new Map() before that would throw.
const READY_CALLBACK = 'marshMapsReady'
type GoogleWindow = {
  google: { maps: GoogleMaps }
  gm_authFailure: () => void
  [READY_CALLBACK]: () => void
}

// The script, added once: a second map on the page shares it.
function addScript(key: string) {
  return new Promise<GoogleMaps | null>((resolve) => {
    const script = document.createElement('script')
    const page = window as unknown as GoogleWindow
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=${READY_CALLBACK}`
    script.async = true
    script.dataset.googleMaps = ''
    page[READY_CALLBACK] = () => resolve(page.google.maps)
    script.onerror = () => {
      // Removed and forgotten, so a blocked network doesn't fail every later map.
      script.remove()
      loading = null
      resolve(null)
    }
    page.gm_authFailure = () => {
      refused = true
      window.dispatchEvent(new Event(MAPS_REFUSED_EVENT))
    }
    document.head.appendChild(script)
  })
}

/** Returns Google Maps, or null with no key or no connection, so the page shows a message. */
export function loadGoogleMaps(): Promise<GoogleMaps | null> {
  if (refused) return Promise.resolve(null)
  loading ??= request<{ key: string | null }>('GET', '/api/sites/map-config')
    .then(({ data }) => (data.key ? addScript(data.key) : null))
    .catch(() => {
      loading = null
      return null
    })
  return loading
}
