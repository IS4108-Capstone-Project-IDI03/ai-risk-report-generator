// Icon tile (v2 section 5 "Tiles", NEW shared piece): the 32 px rounded square with one icon that
// leads a row or a card heading (an Inbox row, a notification, a New Assessment card, a figure).
// One component so every leading tile has the same size, radius and tone colours.
// Called by FigureTile and feature rows. Calls Icon.
import type * as React from 'react'
import { Icon } from '../core/Icon'
import './icon-tile.css'

// neutral grey, ink blue, navy (the First survey tile's blue), violet, the three state colours,
// and outline: a white tile with a hairline border and a navy icon (a site).
export type IconTileTone =
  'neutral' | 'ink' | 'navy' | 'violet' | 'danger' | 'warn' | 'good' | 'outline'

export type IconTileProps = {
  // Left out, the tile is an empty placeholder (an assessment with no type chosen yet).
  icon?: string
  tone?: IconTileTone
  // The tile's side in px (32 by default); the icon is half of it.
  size?: number
  className?: string
  style?: React.CSSProperties
  'data-icon'?: string
}

/** Returns a decorative tile (hidden from screen readers: the words beside it carry the meaning). */
export function IconTile({
  icon,
  tone = 'neutral',
  size = 32,
  className,
  style,
  'data-icon': dataIcon,
}: IconTileProps) {
  return (
    <span
      className={className ? `ds-icon-tile ${className}` : 'ds-icon-tile'}
      data-tone={tone}
      data-icon={dataIcon}
      aria-hidden="true"
      style={size === 32 ? style : { width: size, height: size, ...style }}
    >
      {icon ? <Icon name={icon} size={Math.round(size / 2)} /> : null}
    </span>
  )
}
