// A Details block's heading row (AS-06, boards D1): the small caps label on the left (with its
// count, when it has one), and its actions ("See All", "Open Map", add) on the right. `big` is
// the links-only row of a short screen: a 52px row with a 15px label. Called by every Details block.
import type { ComponentProps, ReactNode } from 'react'
import { Button, CountPill } from '../../../design-system'

/** Returns the heading row; `link` sits at its right end and `count` beside the label. */
export function DetailsHeading({
  children,
  link,
  count,
  big = false,
}: {
  children: ReactNode
  link?: ReactNode
  count?: number
  big?: boolean
}) {
  const title = <h3 className={big ? 'mb-bigrow-label' : 'mb-label'}>{children}</h3>
  return (
    <div className={big ? 'mb-bigrow' : 'mb-labelrow'}>
      {/* The count sits outside the heading, so the heading's own name stays the label. */}
      {count ? (
        <span className="mb-headleft">
          {title}
          <CountPill>{count}</CountPill>
        </span>
      ) : (
        title
      )}
      {link && <span className="mb-headactions">{link}</span>}
    </div>
  )
}

/** Returns a heading row's text link ("See All", "Open Map") with its chevron; the Button's own props pass through. */
export function DetailsLink({ children, ...rest }: Omit<ComponentProps<typeof Button>, 'variant'>) {
  return (
    <Button
      variant="link"
      size="sm"
      iconRight="chevron-right"
      className="ds-press mb-hit"
      // 28px, not the Button's 32: three of these rows must fit the panel without scrolling.
      // Navy, like the client name, in rest and on hover (the Button's own link blue is brighter).
      // The 6px of padding, taken back by an equal negative margin, give the focus ring room: it
      // reads as a pill round the words and the chevron, and nothing moves.
      style={{
        height: 28,
        color: 'var(--marsh-navy)',
        padding: '0 6px',
        margin: '0 -6px',
        borderRadius: 999,
      }}
      {...rest}
    >
      {children}
    </Button>
  )
}
