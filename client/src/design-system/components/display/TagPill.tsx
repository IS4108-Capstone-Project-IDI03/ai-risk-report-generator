// Tag pill (CP-23, v2 section 6): fixed-width "Whole client" / "Site · Assessment" pill.
// Called by document rows; opens a TagPicker. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'

export type TagPillProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  // The tag's text; long text ends in … and the full text shows on hover.
  label: string
  // 164 px in tables (default); `wide` (300 px) is for popovers.
  wide?: boolean
}

/** Returns the tag pill button: tag icon first, text, chevron last. */
export function TagPill({ label, wide = false, ...rest }: TagPillProps) {
  return (
    <button
      type="button"
      className="ds-tag-pill"
      data-wide={wide || undefined}
      title={label}
      {...rest}
    >
      <Icon name="tag" size={14} />
      {/* "RPT-… · site": the reference stays whole, only the site part is cut with … */}
      {label.includes(' · ') ? (
        <span className="ds-tag-pill-text" dir="auto">
          <span className="ds-tag-pill-ref">{label.split(' · ')[0]}</span>
          <span className="ds-tag-pill-site">
            {' · ' + label.split(' · ').slice(1).join(' · ')}
          </span>
        </span>
      ) : (
        <span className="ds-tag-pill-text" dir="auto">
          {label}
        </span>
      )}
      <Icon name="chevron-down" size={14} />
    </button>
  )
}
