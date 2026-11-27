// The Comparison tab's top card (RV-13): which report this assessment is compared with and the
// one action (Compare again), then what changed at a glance: a tile per outcome that filters the
// list, how many outcomes are confirmed, and every figure the gateway measured, each opening its
// item. Called by ComparisonTab. Every count and difference comes from the gateway.
import type { CSSProperties } from 'react'
import { Button, FigureTile, HelpTip, Icon, Select, ViewOnlyChip } from '../../../design-system'
import { formatDayYearTime } from '../format'
import type { Comparison, ComparisonPage } from './api'
import { confirmedCount, countTiles, measuredChanges, reportLine } from './comparisonDisplay'

type Props = {
  page: ComparisonPage
  comparison: Comparison | null
  running: boolean
  outcome: string
  onOutcome: (key: string) => void
  onRun: () => void
  onPick: (reference: string) => void
  onOpenItem: (key: string) => void
}

export function ComparisonSummary({
  page,
  comparison,
  running,
  outcome,
  onOutcome,
  onRun,
  onPick,
  onOpenItem,
}: Props) {
  const previous = page.previous!
  const noObservation = page.observations === 0
  const tiles = comparison ? countTiles(comparison.counts) : []
  const confirmed = comparison ? confirmedCount(comparison.items) : null
  const measured = comparison ? measuredChanges(comparison.items) : []

  return (
    <section className="cmp-card cmp-summary" aria-label="Report compared with">
      <div className="cmp-head">
        <span className="cmp-head-tile" aria-hidden="true">
          <Icon name="git-compare-arrows" size={22} />
        </span>
        <div className="cmp-head-text">
          <span className="cmp-label-row">
            <span className="cmp-label">{'Compared with'}</span>
            <HelpTip label="About this comparison">
              <p>
                {
                  'Each finding and recommendation in the earlier report is checked against this assessment’s observations and draft findings. Every outcome is a suggestion for you to confirm.'
                }
              </p>
              <p>
                {'Nothing here changes the report or its export.'}
                {comparison?.privacy?.enabled
                  ? ' Client details were masked before anything was sent.'
                  : ''}
              </p>
            </HelpTip>
          </span>
          {page.previousReports.length > 1 ? (
            <Select
              aria-label="Compared with"
              size="sm"
              value={previous.reference}
              disabled={running}
              options={page.previousReports.map((r) => ({
                value: r.reference,
                label: reportLine(r),
              }))}
              onChange={(e) => onPick(e.target.value)}
            />
          ) : (
            <p className="cmp-facts">{reportLine(previous)}</p>
          )}
          {comparison && (
            <p className="cmp-sub">
              {`Compared ${formatDayYearTime(new Date(comparison.ranAt))} by ${comparison.ranBy.name}`}
            </p>
          )}
        </div>
        <div className="cmp-head-actions">
          {!page.canChange && (
            <ViewOnlyChip>
              {page.readOnly === 'archived' ? 'Archived · view only' : 'View only'}
            </ViewOnlyChip>
          )}
          {page.canChange && (
            <Button
              variant="primary"
              pill
              iconLeft={comparison ? 'refresh-cw' : 'sparkles'}
              loading={running}
              disabled={running}
              disabledReason={
                noObservation
                  ? {
                      title: 'Can’t compare yet',
                      text: 'Save at least one observation, then you can compare with the previous report.',
                    }
                  : undefined
              }
              onClick={onRun}
            >
              {comparison ? 'Compare again' : 'Compare with previous report'}
            </Button>
          )}
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="cmp-block">
          <div className="cmp-block-head">
            <h2 className="cmp-title">{'What changed'}</h2>
            {confirmed && (
              <span className="cmp-sub cmp-confirmed">
                <strong>{confirmed.done}</strong>
                {` of ${confirmed.of} outcomes confirmed`}
              </span>
            )}
          </div>
          <ul
            className="cmp-tiles ds-figure-grid ds-figure-grid--fill"
            role="group"
            aria-label="Filter by outcome"
            style={{ '--figure-cols': tiles.length } as CSSProperties}
          >
            {tiles.map((t) => (
              <li key={t.key}>
                <FigureTile
                  label={t.label}
                  value={t.n}
                  icon={t.icon}
                  tone={t.tone}
                  pressed={outcome === t.key}
                  onPress={() => onOutcome(t.key)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {measured.length > 0 && (
        <div className="cmp-block">
          <h3 className="cmp-label">{'Measured changes'}</h3>
          <ul className="cmp-measured">
            {measured.map(({ item, figure }) => (
              <li key={`${item.key}|${figure.name}|${figure.source}`}>
                <button
                  type="button"
                  className="cmp-measure"
                  aria-label={`Open ${figure.name}`}
                  onClick={() => onOpenItem(item.key)}
                >
                  <span className="cmp-measure-name">{figure.name}</span>
                  <span className="cmp-measure-values">
                    {figure.previous}
                    <Icon name="arrow-right" size={12} color="var(--graphite-500)" />
                    {figure.current}
                  </span>
                  <span className="cmp-measure-diff">{figure.difference ?? figure.note}</span>
                  <Icon name="chevron-right" size={16} color="var(--graphite-500)" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
