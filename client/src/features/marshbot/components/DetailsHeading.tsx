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
      variant="link-navy"
      size="xs"
      pill
      iconRight="chevron-right"
      // mb-link-row (details.css) takes back the xs link's 6px padding, so nothing moves.
      className="ds-press mb-hit mb-link-row"
      {...rest}
    >
      {children}
    </Button>
  )
}
