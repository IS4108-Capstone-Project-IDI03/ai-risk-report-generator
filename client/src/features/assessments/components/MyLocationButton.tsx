// The Use my current location button (CP-26). Used by LocationForm.tsx,
// SiteMapCard.tsx and the New Assessment form's SiteCard.tsx. Calls myLocation.ts.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system'
import type { Coordinates } from '../googleMaps'
import { BLOCK_RANGE_METRES, currentPosition } from '../myLocation'
import '../site-map.css'

export function MyLocationButton({
  onFound,
  disabled,
}: {
  onFound: (point: Coordinates) => void | Promise<void>
  disabled?: boolean
}) {
  const [finding, setFinding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // The position can take 15 s. If the engineer cancels or closes meanwhile the
  // button unmounts, and a late answer must not save a pin they abandoned.
  const here = useRef(true)
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
    }
  }, [])

  const locate = async () => {
    setFinding(true)
    setMessage(null)
    try {
      const { point, accuracy } = await currentPosition()
      if (!here.current) return
      if (accuracy > BLOCK_RANGE_METRES) setMessage('Your location is too rough to use here.')
      else await onFound(point)
    } catch (error: unknown) {
      if (here.current)
        setMessage(error instanceof Error ? error.message : 'We couldn’t find you. Try again.')
    } finally {
      if (here.current) setFinding(false)
    }
  }

  return (
    <div className="sm-locate">
      <Button
        variant="secondary"
        size="sm"
        iconLeft="locate-fixed"
        disabled={finding || disabled}
        onClick={() => void locate()}
      >
        {finding ? 'Finding you…' : 'Use my current location'}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  )
}
