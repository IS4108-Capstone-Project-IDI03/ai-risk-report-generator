// Section 4's scores table in Review (GN-03), laid out as Marsh's template (p. 10):
// Main Category · Current Score · Potential Score, the Rating Legend beside them, and
// the Location Risk Quality Score and Rating the gateway computes. The assigned
// engineer types the scores here, and the Client and Occupancy Peer Group scores that RQR
// Score Benchmarking compares with (GN-12). Marsh's Rating Legend sits beside the table,
// and each rating takes its band's colour. Used by ReviewWorkspace above Section 4's comments.
import { lazy, useState } from 'react'
import { Badge, Button, Callout, Input } from '../../../design-system'
import {
  getRiskQuality,
  saveRiskQuality,
  type CategoryScore,
  type Rated,
  type RiskQuality,
} from '../api'
import { NOT_ENTERED, toFigure, toText } from '../reportFigures'
import { useFigures } from '../useFigures'
import { ChartBoundary } from './ChartBoundary'

type Typed = { current: string; potential: string }
// A rating's colour class, as the legend's (review.css, Marsh's band colours).
const bandClass = (rated: Rated | null) =>
  rated ? `rv-band-${rated.rating.toLowerCase()}` : undefined

// Marsh's Section 4 charts (GN-12) load on first view: they bring the chart library.
const RiskQualityCharts = lazy(() =>
  import('./RiskQualityCharts').then((m) => ({ default: m.RiskQualityCharts })),
)

// A computed side's cell: the figure, or "Not entered" (AC1).
const shown = (rated: Rated | null, pick: (r: Rated) => string) =>
  rated ? pick(rated) : NOT_ENTERED

export function RiskQualityFigures({
  reference,
  canEdit,
  onSaved,
}: {
  reference: string
  canEdit: boolean
  onSaved?: () => void
}) {
  const { figures, error, saving, save } = useFigures(
    reference,
    getRiskQuality,
    saveRiskQuality,
    onSaved,
  )
  // What the engineer has typed, by category; reset to the saved scores whenever new
  // ones arrive (load or save), during render as React advises rather than in an effect.
  const [typed, setTyped] = useState<Record<string, Typed>>({})
  const [loaded, setLoaded] = useState<RiskQuality | null>(null)
  const [benchmarks, setBenchmarks] = useState({ client: '', peerGroup: '' })
  if (figures && figures !== loaded) {
    setLoaded(figures)
    setBenchmarks({
      client: toText(figures.benchmarks?.client ?? null),
      peerGroup: toText(figures.benchmarks?.peerGroup ?? null),
    })
    setTyped(
      Object.fromEntries(
        figures.categories.map((c) => [
          c.category,
          { current: toText(c.current), potential: toText(c.potential) },
        ]),
      ),
    )
  }

  if (!figures)
    return error ? (
      <Callout tone="warning" title="Scores not loaded">
        {error}
      </Callout>
    ) : null
  const { current, potential, basis } = figures.result
  // The gateway's categories, in template order, so the client keeps no copy to fall behind.
  const names = figures.categories.map((c) => c.category)
  const scores: CategoryScore[] = names.map((category) => ({
    category,
    current: toFigure(typed[category]?.current ?? ''),
    potential: toFigure(typed[category]?.potential ?? ''),
  }))
  const cell = (category: string, side: keyof Typed) =>
    canEdit ? (
      <Input
        size="sm"
        type="number"
        min={0}
        max={10}
        step={0.1}
        aria-label={`${category} ${side} score`}
        value={typed[category]?.[side] ?? ''}
        onChange={(e) =>
          setTyped((t) => ({ ...t, [category]: { ...t[category], [side]: e.target.value } }))
        }
      />
    ) : (
      typed[category]?.[side] || NOT_ENTERED
    )

  return (
    <div className="rv-maturity">
      <div className="rv-maturity-scroll">
        <table className="rv-maturity-table rv-figures-table" aria-label="Risk quality scores">
          <thead>
            <tr>
              <th scope="col">Main Category</th>
              <th scope="col">Current Score</th>
              <th scope="col">Potential Score</th>
            </tr>
          </thead>
          <tbody>
            {names.map((category) => (
              <tr key={category}>
                <th scope="row">{category}</th>
                <td>{cell(category, 'current')}</td>
                <td>{cell(category, 'potential')}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Location Risk Quality Score</th>
              <td>{shown(current, (r) => r.score.toFixed(1))}</td>
              <td>{shown(potential, (r) => r.score.toFixed(1))}</td>
            </tr>
            <tr>
              <th scope="row">Location Risk Quality Rating</th>
              <td className={bandClass(current)}>{shown(current, (r) => r.rating)}</td>
              <td className={bandClass(potential)}>{shown(potential, (r) => r.rating)}</td>
            </tr>
          </tbody>
        </table>
        {/* Beside the table: Marsh's Rating Legend (template p. 10), and under it the
            scores RQR Score Benchmarking compares the location with (AC8), from Marsh's
            records. Each optional: a score not entered has no bar. */}
        <div className="rv-figures-side">
          <div className="rv-legend">
            <h4 id="rv-legend-title">Rating Legend</h4>
            <ul aria-labelledby="rv-legend-title">
              {basis.legend.map((band) => (
                <li key={band} className={`rv-band-${band[0].toLowerCase()}`}>
                  {band}
                </li>
              ))}
            </ul>
          </div>
          <div className="rv-legend rv-benchmarks">
            <h4>Benchmarking</h4>
            {(
              [
                ['client', 'Client Score'],
                ['peerGroup', 'Occupancy Peer Group Score'],
              ] as const
            ).map(([key, label]) =>
              canEdit ? (
                // Input labels itself: no wrapping label (a label inside a label is invalid).
                <div key={key}>
                  <Input
                    label={label}
                    size="sm"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={benchmarks[key]}
                    onChange={(e) => setBenchmarks((b) => ({ ...b, [key]: e.target.value }))}
                  />
                </div>
              ) : (
                <p key={key}>
                  {label}: {benchmarks[key] || NOT_ENTERED}
                </p>
              ),
            )}
          </div>
        </div>
      </div>
      {error && (
        <div role="alert">
          <Callout tone="warning" title="Scores not saved">
            {error}
          </Callout>
        </div>
      )}
      <div className="rv-figures-actions">
        <Badge tone="moderate">Provisional weights</Badge>
        {canEdit && (
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                categories: scores,
                benchmarks: {
                  client: toFigure(benchmarks.client),
                  peerGroup: toFigure(benchmarks.peerGroup),
                },
              })
            }
          >
            Save scores
          </Button>
        )}
      </div>
      {/* The basis behind the score and rating (AC3). */}
      <details className="rv-muted">
        <summary>How the score and rating are worked out</summary>
        <p>
          Location score = the sum of each category's score × its weight × 10, to one decimal; the
          rating is the legend band it falls in. Rules {basis.rulesVersion}.
        </p>
        <ul>
          {basis.weights.map((w) => (
            <li key={w.category}>
              {w.category}: weight {(w.weight * 100).toFixed(1)}%
            </li>
          ))}
        </ul>
        <p>
          Current: {shown(current, (r) => `${r.score.toFixed(1)}, band ${r.band}`)}. Potential:{' '}
          {shown(potential, (r) => `${r.score.toFixed(1)}, band ${r.band}`)}.
        </p>
        <p>
          Marsh's Global Risk Quality Rating spreadsheet weights the categories differently; these
          equal weights are provisional until it is received.
        </p>
      </details>
      {/* Drawn from the saved figures, so saving a score redraws them (GN-12 AC2). */}
      <ChartBoundary>
        <RiskQualityCharts figures={figures} />
      </ChartBoundary>
    </div>
  )
}
