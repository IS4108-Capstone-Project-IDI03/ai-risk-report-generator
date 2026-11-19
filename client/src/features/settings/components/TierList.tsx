// The ranked list of source tiers (RT-04): rank 1 is the highest authority.
// Reorder by drag or by the up/down buttons (keyboard). Used by screens/SourcePrioritySection.tsx.
import { useState } from 'react'
import { Icon, IconButton } from '../../../design-system'
import { move, TIER_LABELS, type TierId } from '../tiers'

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
  return (
    <ol className="st-tiers" aria-label="Source priority, highest authority first">
      {order.map((tier, i) => (
        <li
          key={tier}
          className={dragging === i ? 'st-tier is-dragging' : 'st-tier'}
          draggable={canEdit}
          onDragStart={() => setDragging(i)}
          onDragOver={(e) => canEdit && dragging !== null && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging !== null) onChange(move(order, dragging, i))
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
          <span className="st-tier-name">{TIER_LABELS[tier]}</span>
          <IconButton
            icon="chevron-up"
            size="lg"
            label={`Move ${TIER_LABELS[tier]} up`}
            disabled={!canEdit || i === 0}
            onClick={() => onChange(move(order, i, i - 1))}
          />
          <IconButton
            icon="chevron-down"
            size="lg"
            label={`Move ${TIER_LABELS[tier]} down`}
            disabled={!canEdit || i === order.length - 1}
            onClick={() => onChange(move(order, i, i + 1))}
          />
        </li>
      ))}
    </ol>
  )
}
