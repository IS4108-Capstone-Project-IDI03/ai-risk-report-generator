// "Change between visits" on the Insights tab (CP-29): for each site, its
// first visit against its latest on one axis, for the measure chosen. A table,
// so every value is also text: the track is the picture, the last column the
// figures. Called by screens/InsightsTab; rows from ../insights.ts.
import { Badge, SegmentedControl, useIsPhone } from '../../../design-system'
import type { InsightSite } from '../api'
import { BADGE_TONE, changeRows, changeScale, MEASURES, type Measure } from '../insights'

const pct = (share: number) => `${Math.min(1, Math.max(0, share)) * 100}%`
// On a phone the three full names don't fit one row, so two are shortened;
// the table's own name keeps the full one.
const SHORT: Record<Measure, string> = {
  severity: 'Critical and High',
  ofis: 'OFIs',
  score: 'Score',
}
const CHIP_ICON: Record<string, string | undefined> = {
  good: 'circle-check',
  danger: 'triangle-alert',
}

export function VisitChange({
  sites,
  focus,
  measure,
  onMeasure,
}: {
  sites: InsightSite[]
  focus: string | null
  measure: Measure
  onMeasure: (measure: Measure) => void
}) {
  const { max, ticks } = changeScale(sites, measure)
  const rows = changeRows(sites, measure, max)
  const phone = useIsPhone()
  return (
    <>
      <div className="ci-change-controls">
        <SegmentedControl
          ariaLabel="Measure"
          options={phone ? MEASURES.map((m) => ({ ...m, label: SHORT[m.value] })) : MEASURES}
          value={measure}
          onChange={onMeasure}
        />
        <div className="ci-legend" aria-hidden="true">
          <span>
            <span className="ci-dot" data-kind="first" />
            {'First visit'}
          </span>
          <span>
            <span className="ci-dot" data-kind="latest" />
            {'Latest visit'}
          </span>
        </div>
      </div>
      <table className="ci-change">
        <caption className="cl-sr">
          {`${MEASURES.find((m) => m.value === measure)!.label}, first visit against latest`}
        </caption>
        {/* The widths are the columns' own: the hidden heading row would otherwise set them. */}
        <colgroup>
          <col className="ci-change-site" />
          <col />
          <col className="ci-change-figures" />
        </colgroup>
        <thead className="cl-sr">
          <tr>
            <th scope="col">{'Site'}</th>
            <th scope="col">{'Chart'}</th>
            <th scope="col">{'First to latest'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-dim={(focus && focus !== row.id) || undefined}>
              <th scope="row">
                <span className="ci-change-name" dir="auto" title={row.name}>
                  {row.name}
                </span>
                {row.period && <span className="ci-change-period">{row.period}</span>}
              </th>
              <td aria-hidden="true">
                <span className="ci-track">
                  {row.span && (
                    <span
                      className="ci-span"
                      style={{ left: pct(row.span.from), width: pct(row.span.width) }}
                    />
                  )}
                  {row.points.map((point) => (
                    <span
                      key={point.label}
                      className="ci-dot"
                      data-kind={point.kind}
                      title={point.label}
                      style={{ left: pct(point.at) }}
                    />
                  ))}
                </span>
              </td>
              <td>
                <span className="cl-sr">{row.label}</span>
                <span className="ci-change-values" aria-hidden="true">
                  {row.values}
                </span>
                <span aria-hidden="true">
                  <Badge tone={BADGE_TONE[row.chip.tone]} icon={CHIP_ICON[row.chip.tone]}>
                    {row.chip.text}
                  </Badge>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot aria-hidden="true">
          <tr>
            <td />
            <td>
              <span className="ci-ticks">
                {ticks.map((tick) => (
                  <span key={tick} style={{ left: pct(tick / max) }}>
                    {tick}
                  </span>
                ))}
              </span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </>
  )
}
