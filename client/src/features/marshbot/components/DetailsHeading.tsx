// A Details block's heading row (AS-06, boards D1): the small caps label on the left, and its
// link ("See All", "Open Map") on the right. `big` is the links-only row of a short screen: a
// 52px row with a 15px label. Called by every Details block.
import type { ReactNode } from 'react'

/** Returns the heading row; `link` sits at its right end. */
export function DetailsHeading({
  children,
  link,
  big = false,
}: {
  children: ReactNode
  link?: ReactNode
  big?: boolean
}) {
  return (
    <div className={big ? 'mb-bigrow' : 'mb-labelrow'}>
      <h3 className={big ? 'mb-bigrow-label' : 'mb-label'}>{children}</h3>
      {link}
    </div>
  )
}
