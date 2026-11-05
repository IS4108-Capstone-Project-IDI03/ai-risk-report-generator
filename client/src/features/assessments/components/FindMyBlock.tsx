// Follows the engineer live while the location picker is open, and narrows it to
// the block they're in (CP-26). They still tap the location, because GPS can't
// tell one level or room from another. Nothing here is saved, and closing the
// picker stops it. Used by LocationSheet.tsx. Calls myLocation.ts, and
// googleMaps.ts for the nearest street address, which sends the position to Google.
import { useEffect, useState } from 'react'
import { Button } from '../../../design-system'
import { formatCoordinates, streetAddress, type Coordinates } from '../googleMaps'
import {
  ADDRESS_STEP_METRES,
  BLOCK_RANGE_METRES,
  distanceMetres,
  nearestBlock,
  trackPosition,
  type MyPosition,
} from '../myLocation'
import '../site-map.css'

export function FindMyBlock({
  pins,
  onBlock,
  onHere,
}: {
  pins: (Coordinates & { name: string })[]
  onBlock: (name: string | null) => void
  // Each usable reading, for the Add a location form; null when there is none.
  onHere: (point: Coordinates | null) => void
}) {
  const [tracking, setTracking] = useState(false)
  const [position, setPosition] = useState<MyPosition | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Runs until tracking ends for any reason, the picker closing included. The
  // clean-up widens the list too, so no block filter outlives the tracking.
  useEffect(() => {
    if (!tracking) return
    let lookedUp: Coordinates | null = null
    let live = true
    const stopWatching = trackPosition(
      (now) => {
        setPosition(now)
        setProblem(null)
        const usable = now.accuracy <= BLOCK_RANGE_METRES
        onHere(usable ? now.point : null)
        // Billed per lookup, so not on every reading, never for a rough one, and
        // not for GPS drifting within its own accuracy.
        if (!usable) return
        const step = Math.max(ADDRESS_STEP_METRES, now.accuracy)
        if (lookedUp && distanceMetres(lookedUp, now.point) < step) return
        const point = now.point
        lookedUp = point
        void streetAddress(point).then((found) => {
          // Only the latest lookup, as answers can arrive out of order.
          if (live && lookedUp === point) setAddress(found)
        })
      },
      (message, ended) => {
        setProblem(message)
        if (ended) setTracking(false)
      },
    )
    return () => {
      live = false
      stopWatching()
      setPosition(null)
      setAddress(null)
      onBlock(null)
      onHere(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- both are new on every render
  }, [tracking])

  const rough = !!position && position.accuracy > BLOCK_RANGE_METRES
  const block = position && !rough ? (nearestBlock(position.point, pins)?.name ?? null) : null
  // Only when the block changes, so "Show all locations" isn't undone by each new reading.
  useEffect(() => {
    if (tracking) onBlock(block)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onBlock is new on every render
  }, [tracking, block])

  const status =
    problem ??
    (!tracking
      ? null
      : !position
        ? 'Finding you…'
        : rough
          ? 'Your location is too rough to use here.'
          : block
            ? 'You’re near ' + block + '.'
            : pins.length
              ? 'You’re not near a pinned block. Choose from the list.'
              : 'No blocks are pinned for this visit yet. Choose from the list.')

  return (
    <div className="sm-locate">
      <Button
        variant="secondary"
        size="sm"
        iconLeft="locate-fixed"
        onClick={() => {
          setProblem(null)
          setTracking(!tracking)
        }}
      >
        {tracking ? 'Stop tracking' : 'Track my location'}
      </Button>
      {status && <p role="status">{status}</p>}
      {tracking && !rough && address && <p>{'Near ' + address}</p>}
      {/* Apart from the status, so a screen reader isn't read every new reading. */}
      {tracking && position && (
        <p>
          {formatCoordinates(position.point) + ', within ' + Math.round(position.accuracy) + ' m'}
        </p>
      )}
    </div>
  )
}
