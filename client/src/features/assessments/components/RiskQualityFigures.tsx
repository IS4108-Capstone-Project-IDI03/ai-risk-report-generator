// Section 4's scores table in Review (GN-03), laid out as Marsh's template (p. 10):
// Main Category · Current Score · Potential Score, the Rating Legend beside them, and
// the Location Risk Quality Score and Rating the gateway computes. The assigned
// engineer types the scores here, or asks the model to propose them and confirms
// (GN-03 addendum). Used by ReviewWorkspace above Section 4's comments.
import { lazy, useState } from 'react'
import { Badge, Button, Callout, Input } from '../../../design-system'
import {
  getRiskQuality,
  proposeRiskQuality,
  saveRiskQuality,
  type CategoryScore,
  type Rated,
  type RiskQuality,
} from '../api'
import { NOT_ENTERED, toFigure, toText } from '../reportFigures'
import { useFigures } from '../useFigures'
import { ChartBoundary } from './ChartBoundary'
import { ProposalNote } from './ProposalNote'

type Typed = { current: string; potential: string }
// A proposed input's key, e.g. "Fire Protection:current".
const keyOf = (category: string, side: keyof Typed) => `${category}:${side}`

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
  const { figures, error, saving, save, proposing, propose } = useFigures(
    reference,
    getRiskQuality,
    saveRiskQuality,
    onSaved,
    proposeRiskQuality,
  )
  // What the engineer has typed, by category; reset to the saved scores whenever new
  // ones arrive (load or save), during render as React advises rather than in an effect.
  const [typed, setTyped] = useState<Record<string, Typed>>({})
  const [loaded, setLoaded] = useState<RiskQuality | null>(null)
  // The inputs still holding the model's proposal; editing one drops its marking (AC13).
  const [proposed, setProposed] = useState<Set<string>>(new Set())
  if (figures && figures !== loaded) {
    setLoaded(figures)
    // A proposal is only sent while no score is entered, so it fills every box it can.
    const offered = new Map(figures.proposal?.categories.map((p) => [p.category, p]))
    const fill = (category: string, side: keyof Typed, saved: number | null) =>
      toText(saved ?? offered.get(category)?.[side] ?? null)
    setTyped(
      Object.fromEntries(
        figures.categories.map((c) => [
          c.category,
          {
            current: fill(c.category, 'current', c.current),
            potential: fill(c.category, 'potential', c.potential),
          },
        ]),
      ),
    )
    setProposed(
      new Set(
        [...offered.values()].flatMap((p) =>
          (['current', 'potential'] as const)
            .filter((side) => p[side] !== null)
            .map((side) => keyOf(p.category, side)),
        ),
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
  const why = new Map(figures.proposal?.categories.map((p) => [p.category, p]))
  const entered = figures.categories.some((c) => c.current !== null || c.potential !== null)
  const cell = (category: string, side: keyof Typed) =>
    canEdit ? (
      <span className={proposed.has(keyOf(category, side)) ? 'rv-proposed' : undefined}>
        <Input
          size="sm"
          type="number"
          min={0}
          max={10}
          step={0.1}
          aria-label={`${category} ${side} score`}
          value={typed[category]?.[side] ?? ''}
          onChange={(e) => {
            setTyped((t) => ({ ...t, [category]: { ...t[category], [side]: e.target.value } }))
            setProposed((p) => new Set([...p].filter((k) => k !== keyOf(category, side))))
          }}
        />
      </span>
    ) : (
      typed[category]?.[side] || NOT_ENTERED
    )

  return (
    <div className="rv-maturity">
      {figures.proposal && proposed.size > 0 && (
        <ProposalNote
          proposal={figures.proposal}
          // Only the categories with a figure still as proposed: an edited one is the
          // engineer's, and the model's reason no longer speaks for it.
          reasons={[...why.values()]
            .filter(
              (p) =>
                proposed.has(keyOf(p.category, 'current')) ||
                proposed.has(keyOf(p.category, 'potential')),
            )
            .map((p) => [p.category, p])}
        />
      )}
      <div className="rv-maturity-scroll">
        <table className="rv-maturity-table rv-figures-table" aria-label="Risk quality scores">
          <thead>
            <tr>
              <th scope="col">Main Category</th>
              <th scope="col">Current Score</th>
              <th scope="col">Potential Score</th>
              <th scope="col">Rating Legend</th>
            </tr>
          </thead>
          <tbody>
            {names.map((category, i) => (
              <tr key={category}>
                <th scope="row">{category}</th>
                <td>{cell(category, 'current')}</td>
                <td>{cell(category, 'potential')}</td>
                {/* Marsh's legend sits beside the first five rows. */}
                <td>{basis.legend[i] ?? ''}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Location Risk Quality Score</th>
              <td>{shown(current, (r) => r.score.toFixed(1))}</td>
              <td>{shown(potential, (r) => r.score.toFixed(1))}</td>
              <td />
            </tr>
            <tr>
              <th scope="row">Location Risk Quality Rating</th>
              <td>{shown(current, (r) => r.rating)}</td>
              <td>{shown(potential, (r) => r.rating)}</td>
              <td />
            </tr>
          </tbody>
        </table>
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
        {canEdit && !entered && !figures.proposal && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft="sparkles"
            loading={proposing}
            onClick={() => void propose()}
          >
            Propose figures
          </Button>
        )}
        {canEdit && (
          <Button variant="primary" size="sm" disabled={saving} onClick={() => save(scores)}>
            {/* Saving proposed figures is the engineer confirming them (AC14). */}
            {proposed.size ? 'Confirm figures' : 'Save scores'}
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
