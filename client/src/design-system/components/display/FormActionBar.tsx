// Sticky form action bar (CP-23, board 08/23): Cancel + the primary action, pinned to the bottom.
// Called by the New Assessment / manual forms. Calls Button.
import type { ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { Button } from '../core/Button'

export type FormActionBarProps = {
  onCancel: () => void
  primaryLabel: ReactNode
  onPrimary: () => void
  primaryLoading?: boolean
}

const big = { height: 48, fontSize: 16 }

/** Returns the bar; it sticks to the bottom of the scrolling page with safe-area padding. */
export function FormActionBar({
  onCancel,
  primaryLabel,
  onPrimary,
  primaryLoading,
}: FormActionBarProps) {
  return (
    <div className="ds-action-bar">
      <Button variant="pill" style={big} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="create"
        style={big}
        // Not Button's `loading` (it would add a spinner beside the word and change the width):
        // the word is kept, hidden, so the button stays as wide as it was (board 17 · 6).
        aria-busy={primaryLoading || undefined}
        aria-label={typeof primaryLabel === 'string' ? primaryLabel : undefined}
        onClick={primaryLoading ? undefined : onPrimary}
      >
        <span style={{ display: 'inline-flex', position: 'relative', alignItems: 'center' }}>
          {/* The tick before the word, as boards 08 and 23 draw it. */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              visibility: primaryLoading ? 'hidden' : undefined,
            }}
          >
            <Icon name="check" size={18} />
            {primaryLabel}
          </span>
          {primaryLoading ? (
            <Icon
              name="loader-circle"
              size={18}
              style={{
                position: 'absolute',
                inset: 0,
                margin: 'auto',
                animation: 'dsSpin 0.9s linear infinite',
              }}
            />
          ) : null}
        </span>
      </Button>
    </div>
  )
}
