// Dashed add row (CP-23, v2 section 6): full-width "+ Add a site" row.
// Called by forms and popovers that add items. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type AddRowProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: React.ReactNode
  // Busy: the plus becomes a spinner and the row ignores presses until the work is done. It stays
  // focusable (aria-disabled), or a keyboard user's focus would be dropped when the work starts.
  loading?: boolean
}

/** Returns a 44 px full-width button with a 1.5 px dashed border and a plus (a spinner while loading, still focusable). */
export function AddRow({ children, loading = false, onClick, ...rest }: AddRowProps) {
  return (
    <button
      type="button"
      className="ds-add-row"
      {...rest}
      onClick={loading ? undefined : onClick}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Icon name="loader-circle" size={16} style={{ animation: 'dsSpin 0.9s linear infinite' }} />
      ) : (
        <Icon name="plus" size={16} />
      )}
      {children}
    </button>
  )
}
