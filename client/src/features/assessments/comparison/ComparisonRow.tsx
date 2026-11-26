// One item in the Comparison tab's list (RV-13): the previous item's heading, its words (two
// lines), where it was and how its severity moved, and its outcome pill at the right. The whole
// row is a button that opens the item. Called by ComparisonTab.
import { Badge } from '../../../design-system'
import type { ComparisonItem, CurrentSource } from './api'
import { SeverityShift } from './ComparisonDetail'
import { itemText, itemTitle, outcomePill, SEVERITY_LABEL } from './comparisonDisplay'

export function ComparisonRow({
  item,
  sources,
  open,
  onOpen,
}: {
  item: ComparisonItem
  sources: ReadonlyMap<string, CurrentSource>
  open: boolean
  onOpen: () => void
}) {
  const pill = outcomePill(item)
  const level = item.severity ? null : item.level && SEVERITY_LABEL[item.level]
  return (
    <li>
      <button
        type="button"
        className="cmp-row"
        aria-current={open || undefined}
        data-dismissed={item.dismissed || undefined}
        onClick={onOpen}
      >
        <span className="cmp-row-main">
          <span className="cmp-row-title">{itemTitle(item, sources)}</span>
          <span className="cmp-row-text" dir="auto">
            {itemText(item, sources)}
          </span>
          <span className="cmp-row-meta">
            {item.previous && <span>{item.previous.section}</span>}
            {item.severity && <SeverityShift severity={item.severity} />}
            {level && <span>{level}</span>}
          </span>
        </span>
        <span className="cmp-row-badges">
          <Badge tone={pill.tone} icon={pill.icon}>
            {pill.label}
          </Badge>
          {item.recheck && (
            <Badge tone="moderate" icon="rotate-ccw">
              {'Look again'}
            </Badge>
          )}
        </span>
      </button>
    </li>
  )
}
