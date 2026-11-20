// The ranked list of source tiers (RT-04): rank 1 is the highest authority.
// Reorder by drag or by the up/down buttons (keyboard). Used by screens/SourcePrioritySection.tsx.
// A moved row slides to its new place (FLIP: it starts where it was and eases to where it is),
// glows briefly, and the new place is announced to screen readers.
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, IconButton } from '../../../design-system'
import { move, TIER_ICONS, TIER_LABELS, type TierId } from '../tiers'

export function TierList({
  order,
  canEdit,
  onChange,
}: {
  order: TierId[]
  canEdit: boolean
  onChange: (order: TierId[]) => void
}) {
  // Which row is being dragged; null when none. Without it a drop from outside the list would move a row.
  const [dragging, setDragging] = useState<number | null>(null)
  // The row the person just moved, glowing for about a second, and the sentence read out for it.
  const [moved, setMoved] = useState<{ tier: TierId; said: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const rows = useRef(new Map<TierId, HTMLLIElement>())
  const tops = useRef(new Map<TierId, number>())

  const shift = (from: number, to: number) => {
    const next = move(order, from, to)
    if (next === order) return
    clearTimeout(timer.current)
    setMoved({
      tier: order[from],
      said: `${TIER_LABELS[order[from]]} moved to position ${to + 1} of ${order.length}`,
    })
    timer.current = setTimeout(() => setMoved(null), 1100)
    onChange(next)
  }

  // After every reorder, put each row back where it was and let it ease to its new place.
  // Without this the rows would jump, and the eye could not follow which one moved.
  useLayoutEffect(() => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    rows.current.forEach((el, tier) => {
      const top = el.offsetTop
      const was = tops.current.get(tier)
      if (was !== undefined && was !== top && !calm) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${was - top}px)`
        void el.offsetHeight // commit the start position before easing
        el.style.transition = ''
        el.style.transform = ''
      }
      tops.current.set(tier, top)
    })
  }, [order])

  return (
    <>
      <ol className="st-tiers" aria-label="Source priority, highest authority first">
        {order.map((tier, i) => (
          <li
            key={tier}
            ref={(el) => {
              if (el) rows.current.set(tier, el)
              else rows.current.delete(tier)
            }}
            className={
              'st-tier' +
              (dragging === i ? ' is-dragging' : '') +
              (moved?.tier === tier ? ' is-moved' : '')
            }
            draggable={canEdit}
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => canEdit && dragging !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging !== null) shift(dragging, i)
              setDragging(null)
            }}
            onDragEnd={() => setDragging(null)}
          >
            <span className="st-tier-rank">{i + 1}</span>
            {/* No grip on a read-only list: it would invite a drag that does nothing */}
            {canEdit && (
              <span className="st-tier-grip" data-testid="tier-handle" aria-hidden="true">
                <Icon name="grip-vertical" size={16} color="var(--text-muted)" />
              </span>
            )}
            <span className="st-tier-icon" data-icon={TIER_ICONS[tier]} aria-hidden="true">
              <Icon name={TIER_ICONS[tier]} size={20} color="var(--action-primary)" />
            </span>
            <span className="st-tier-name">{TIER_LABELS[tier]}</span>
            <IconButton
              icon="chevron-up"
              size="lg"
              label={`Move ${TIER_LABELS[tier]} up`}
              disabled={!canEdit || i === 0}
              onClick={() => shift(i, i - 1)}
            />
            <IconButton
              icon="chevron-down"
              size="lg"
              label={`Move ${TIER_LABELS[tier]} down`}
              disabled={!canEdit || i === order.length - 1}
              onClick={() => shift(i, i + 1)}
            />
          </li>
        ))}
      </ol>
      <p className="st-sr-only" role="status" aria-live="polite">
        {moved?.said}
      </p>
    </>
  )
}
