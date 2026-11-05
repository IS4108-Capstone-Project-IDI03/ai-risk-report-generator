// The map itself (CP-26): draws numbered pins, and says so when Google can't
// load. Used by SiteMapCard on the Overview and SiteCard on the create form.
// Calls googleMaps.ts. Keyboard users have the Coordinates field beside it.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import {
  loadGoogleMaps,
  MAPS_REFUSED_EVENT,
  type Coordinates,
  type GoogleMapInstance,
  type GoogleMaps,
  type GoogleMarker,
} from '../googleMaps'
import '../site-map.css'

export type MapPin = Coordinates & { label: string; title: string }

// Where a site with no pins opens. Marsh's team is in Singapore.
// ponytail: fixed on Singapore, centre on the site's jurisdiction if they survey abroad often.
const SINGAPORE = { center: { lat: 1.3521, lng: 103.8198 }, zoom: 11 }
// Close enough to tell one block from another.
const SITE_ZOOM = 18

export function SiteMapView({
  label,
  pins,
  onPick,
  onPinClick,
}: {
  label: string
  pins: MapPin[]
  onPick?: (point: Coordinates) => void
  onPinClick?: (pin: MapPin) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<GoogleMapInstance | null>(null)
  const markers = useRef<GoogleMarker[]>([])
  const [maps, setMaps] = useState<GoogleMaps | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // Read through refs, so the map's one click listener always calls the latest.
  const picked = useRef(onPick)
  const pinClicked = useRef(onPinClick)
  useEffect(() => {
    picked.current = onPick
    pinClicked.current = onPinClick
  })

  // a. Load Google, and hear if it refuses the key afterwards.
  useEffect(() => {
    let current = true
    const refused = () => setUnavailable(true)
    window.addEventListener(MAPS_REFUSED_EVENT, refused)
    void loadGoogleMaps().then((loaded) => {
      if (!current) return
      setMaps(loaded)
      setUnavailable(!loaded)
    })
    return () => {
      current = false
      window.removeEventListener(MAPS_REFUSED_EVENT, refused)
    }
  }, [])

  // b. Create the map once. Satellite view, since blocks are told apart by their roofs.
  useEffect(() => {
    if (!maps || !element.current || map.current) return
    map.current = new maps.Map(element.current, {
      ...SINGAPORE,
      mapTypeId: 'hybrid',
      streetViewControl: false,
      fullscreenControl: false,
    })
    map.current.addListener('click', ({ latLng }) =>
      picked.current?.({ lat: latLng.lat(), lng: latLng.lng() }),
    )
  }, [maps])

  // c. Redraw the pins and frame them. Keyed on their values, because a new
  // array each render would otherwise reset the view the engineer panned to.
  const drawn = JSON.stringify(pins)
  useEffect(() => {
    if (!maps || !map.current) return
    const shown: MapPin[] = JSON.parse(drawn)
    markers.current.forEach((m) => m.setMap(null))
    markers.current = shown.map((pin) => {
      const marker = new maps.Marker({
        map: map.current,
        position: { lat: pin.lat, lng: pin.lng },
        label: pin.label,
        title: pin.title,
      })
      marker.addListener('click', () => pinClicked.current?.(pin))
      return marker
    })
    if (shown.length === 1) {
      map.current.setCenter(shown[0])
      map.current.setZoom(SITE_ZOOM)
    } else if (shown.length > 1) {
      const bounds = new maps.LatLngBounds()
      shown.forEach((p) => bounds.extend(p))
      map.current.fitBounds(bounds)
    }
  }, [maps, drawn])

  if (unavailable)
    return (
      <p className="sm-unavailable" role="status">
        <Icon name="map-pin-off" size={16} color="var(--text-muted)" />
        {'The map isn’t available right now. You can still paste coordinates and get directions.'}
      </p>
    )
  return <div ref={element} className="sm-map" role="region" aria-label={label} />
}
