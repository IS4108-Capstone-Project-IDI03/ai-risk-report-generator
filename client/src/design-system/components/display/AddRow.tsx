// Dashed add row (CP-23, v2 section 6): full-width "+ Add a site" row.
// Called by forms and popovers that add items. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type AddRowProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: React.ReactNode
}

/** Returns a 44 px full-width button with a 1.5 px dashed border and a plus. */
export function AddRow({ children, ...rest }: AddRowProps) {
  return (
    <button type="button" className="ds-add-row" {...rest}>
      <Icon name="plus" size={16} />
      {children}
    </button>
  )
}
