// The bar under the site map while a pin is placed (AS-06, board D3): Coordinates in one wide
// input with a locate button inside its right end (fills the input, saves nothing), then Set Pin
// and Cancel. One row; on a narrow phone the buttons wrap under the input. Called by SiteMapPanel.tsx.
import { useEffect, useRef, useState } from 'react'
import { Button, IconAction, Input, useIsPhone } from '../../../design-system'
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
  // Opening the bar puts the cursor in Coordinates, so the engineer can type or paste at once. Not
  // on a phone or any touch screen (a tablet is wider than a phone): focus there would pop the
  // keyboard up over the map.
  const field = useRef<HTMLDivElement>(null)
  const phone = useIsPhone()
  useEffect(() => {
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    if (!phone && !touch) field.current?.querySelector('input')?.focus()
  }, [phone])
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
  // Enter and the Set Pin button share one rule: nothing to set, or a save already under way,
  // sets nothing (without it a double Enter would send two saves).
  const blank = !typed.trim()
  const set = () => {
    if (!busy && !blank) onSet()
  }
  return (
    <div className="mb-placebar">
      <div ref={field} className="mb-placebar-field">
        <Input
          label="Coordinates"
          placeholder="1.452310, 103.900870"
          name="coordinates"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          style={{ paddingRight: TAP }}
          onChange={(e) => onTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && set()}
        />
        {/* The wrapper sits inside the input's right end; the tooltip's own box would otherwise
            become the button's anchor. */}
        <span className="mb-placebar-locate">
          <IconAction
            icon="locate-fixed"
            label="Use My Location"
            // Ends at the input's right edge, so the label never runs past the window.
            placement="top-end"
            size="md"
            className="mb-hit"
            loading={finding}
            disabled={busy}
            style={{ width: TAP, height: TAP, color: 'var(--marsh-navy)' }}
            onClick={() => void locate()}
          />
        </span>
      </div>
      <div className="mb-placebar-actions">
        <Button
          variant="primary"
          pill
          className="ds-press mb-hit"
          disabled={busy}
          // Greyed but focusable, with the reason (design system v2); busy is plainly disabled.
          disabledReason={
            !busy && blank
              ? { title: 'Can’t set yet', text: 'Type or find the coordinates first.' }
              : undefined
          }
          onClick={set}
        >
          Set Pin
        </Button>
        <Button variant="pill" className="ds-press mb-hit" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
