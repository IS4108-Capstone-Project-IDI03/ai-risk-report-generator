// The bar under the site map while a pin is placed (AS-06, board D3): Coordinates in one wide
// input with a locate button inside its right end (fills the input, saves nothing), then Set Pin
// and Cancel. One row; on a narrow phone the buttons wrap under the input. Called by SiteMapPanel.tsx.
import { useState } from 'react'
import { Button, IconButton, Input } from '../../../design-system'
import { formatCoordinates } from '../../assessments/googleMaps'
import { BLOCK_RANGE_METRES, currentPosition } from '../../assessments/myLocation'

// The locate button is 40px, 44px on a phone (--mb-tap, set in details.css).
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
          label="Use My Location"
          tooltip="Use My Location"
          className="mb-hit mb-placebar-locate"
          disabled={busy || finding}
          style={{ width: TAP, height: TAP, color: 'var(--marsh-navy)' }}
          onClick={() => void locate()}
        />
      </div>
      <div className="mb-placebar-actions">
        <Button
          variant="primary"
          pill
          size="sm"
          className="ds-press mb-hit"
          disabled={busy || !typed.trim()}
          onClick={onSet}
        >
          Set Pin
        </Button>
        <Button
          variant="pill"
          size="sm"
          className="ds-press mb-hit"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
