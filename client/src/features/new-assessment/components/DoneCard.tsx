// The small card over the blurred reading screen once every document is read
// (CP-23, board 11, motion 5): a green tick drawn in, "All N documents read"
// (or "X of N documents read" when some failed), "Preparing the form for you
// now…". Used by screens/ReadingDocuments.tsx.
import { useLayoutEffect, useRef } from 'react'
import { Icon } from '../../../design-system'
import { plural } from '../../clients/formatClient'

export function DoneCard({
  read,
  total,
  leaving,
}: {
  read: number
  total: number
  leaving: boolean
}) {
  const all =
    read < total
      ? `${read} of ${plural(total, 'document')} read`
      : total === 1
        ? '1 document read'
        : 'All ' + plural(total, 'document') + ' read'
  // The card is fixed to the window (new-assessment.css) but centred over the
  // main column, not the sidebar: it takes the scroller's box once it shows.
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = root.current
    const area = el?.closest('.om-scroll')?.getBoundingClientRect()
    if (!el || !area) return
    el.style.inset = `${area.top}px auto auto ${area.left}px`
    el.style.width = area.width + 'px'
    el.style.height = area.height + 'px'
  }, [])
  return (
    <div ref={root} className={'na-done' + (leaving ? ' is-leaving' : '')}>
      <div className="na-done-card" role="status">
        <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
          <circle cx="26" cy="26" r="26" fill="var(--green-600)" />
          <path className="na-done-tick" d="M15 27l7 7 15-16" />
        </svg>
        <strong>{all}</strong>
        <span className="na-muted">
          <Icon name="loader-circle" size={14} className="na-spin" />
          {'Preparing the form…'}
        </span>
      </div>
    </div>
  )
}
