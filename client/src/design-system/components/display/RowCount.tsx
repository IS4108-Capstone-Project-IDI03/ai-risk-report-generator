// Row count with a tab's icon (GN-13, NEW pattern): the number, then the icon of the tab it
// counts (the Observations tab's camera), no label. Icons sit in one column and numbers
// right-align against it. `warn` turns both amber (a count of 0 that blocks something).
// Not animated, on purpose. Used by Generation's step 1 rows.
import { Icon } from '../core/Icon'
import './steps.css'

// "1,284", not "1284".
const COUNT = new Intl.NumberFormat('en-GB')

/** Returns the count; `label` is what a screen reader hears ("12 observations"). */
export function RowCount({
  count,
  icon,
  label,
  warn = false,
}: {
  count: number
  icon: string
  label: string
  warn?: boolean
}) {
  return (
    <span className="ds-rcount" role="img" aria-label={label} data-warn={warn ? '' : undefined}>
      <b>{COUNT.format(count)}</b>
      <Icon name={icon} size={16} />
    </span>
  )
}
