// The bar under the site map while a pin is placed (AS-06, board D3): Coordinates in one wide
// input with a locate button inside its right end (fills the input, saves nothing), then a green
// tick that sets the pin and a cross that cancels. One row. Called by SiteMapPanel.tsx.
import { useState } from 'react'
import { IconButton, Input } from '../../../design-system'
import { formatCoordinates } from '../../assessments/googleMaps'
import { BLOCK_RANGE_METRES, currentPosition } from '../../assessments/myLocation'

// Every button is 40px, 44px on a phone (--mb-tap, set in details.css).
const TAP = 'var(--mb-tap, 40px)'

/** Returns the bar; `typed` is the input's text, `onProblem` shows why the location couldn't be used. */
export function PlacingBar({
  typed,
  onTyped,
  onSet,
  onCancel,
  onProblem,
  busy,
}: {
  typed: string
  onTyped: (text: string) => void
  onSet: () => void
  onCancel: () => void
  onProblem: (message: string | null) => void
  busy: boolean
}) {
  const [finding, setFinding] = useState(false)
  // Puts where the engineer is into the input, to check and set; it saves nothing itself.
  const locate = async () => {
    setFinding(true)
    onProblem(null)
    try {
      const { point, accuracy } = await currentPosition()
      if (accuracy > BLOCK_RANGE_METRES) onProblem('Your location is too rough to use here.')
      else onTyped(formatCoordinates(point))
    } catch (error: unknown) {
      onProblem(error instanceof Error ? error.message : 'We couldn’t find you. Try again.')
    } finally {
      setFinding(false)
    }
  }
  return (
    <div className="mb-placebar">
      <div className="mb-placebar-field">
        <Input
          label="Coordinates"
          placeholder="1.452310, 103.900870"
          name="coordinates"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          style={{ paddingRight: TAP }}
          onChange={(e) => onTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSet()}
        />
        <IconButton
          icon="locate-fixed"
          label="Use my location"
          tooltip="Use my location"
          className="mb-hit mb-placebar-locate"
          disabled={busy || finding}
          style={{ width: TAP, height: TAP, color: 'var(--marsh-navy)' }}
          onClick={() => void locate()}
        />
      </div>
      <IconButton
        icon="check"
        label="Set pin"
        tooltip="Set pin"
        className="mb-hit"
        disabled={busy}
        style={{
          width: TAP,
          height: TAP,
          borderRadius: '50%',
          color: '#fff',
          background: 'var(--green-600)',
        }}
        onClick={onSet}
      />
      <IconButton
        icon="x"
        label="Cancel"
        tooltip="Cancel"
        className="mb-hit"
        disabled={busy}
        style={{ width: TAP, height: TAP }}
        onClick={onCancel}
      />
    </div>
  )
}
