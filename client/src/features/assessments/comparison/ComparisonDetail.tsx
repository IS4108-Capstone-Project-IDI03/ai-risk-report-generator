// One comparison item opened (RV-13): its title and outcome, the decision bar,
// what changed (severity and the gateway's figures), then the evidence on both
// sides: the previous report's words beside this assessment's sources (stacked
// when the panel is narrow). Shown beside the list, under it below 1080 px, and
// in a bottom sheet below 760 px (ComparisonTab decides). Calls DecisionBar and
// the dialogs in DecisionDialogs.tsx; decisions go up through `onDecide`.
import { useState } from 'react'
import { Badge, Callout, ConfidenceIndicator, Icon, IconAction } from '../../../design-system'
import type { ComparisonItem, CurrentSource, Decision } from './api'
import {
  itemTitle,
  outcomePill,
  SEVERITY_LABEL,
  sourceLabel,
  sourceName,
} from './comparisonDisplay'
import { DecisionBar } from './DecisionBar'
import { OutcomeDialog, PairDialog, PairNewDialog } from './DecisionDialogs'
import type { DecisionRefusal } from './useComparison'

/** Returns a pair's severities as "High → Critical", or just "Low" when both reports agree. */
export function SeverityShift({ severity }: { severity: NonNullable<ComparisonItem['severity']> }) {
  if (severity.direction === 0) return <span>{severity.current}</span>
  return (
    <span>
      {severity.previous}
      <span aria-hidden="true">{' → '}</span>
      <span className="ds-sr-only">{' to '}</span>
      {severity.current}
    </span>
  )
}

export type Decide = (item: string, decision: Decision) => Promise<DecisionRefusal | null>

// The decision dialog open, if any.
type OpenDialog = 'outcome' | 'pair' | 'pairNew'

type Props = {
  item: ComparisonItem
  sources: ReadonlyMap<string, CurrentSource>
  // Every previous item, for pairing a New one with the one it matches.
  previousItems: ComparisonItem[]
  canChange: boolean
  deciding: boolean
  onDecide: Decide
  onOpenSource: (source: CurrentSource) => void
  // In the bottom sheet the sheet carries the title, so the panel leaves it out.
  inSheet?: boolean
}

export function ComparisonDetail({
  item,
  sources,
  previousItems,
  canChange,
  deciding,
  onDecide,
  onOpenSource,
  inSheet = false,
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const pill = outcomePill(item)
  const cited = item.sources.flatMap((k) => sources.get(k) ?? [])
  const possible = item.possible.flatMap((k) => sources.get(k) ?? [])
  const disagreeing = item.disagree.flatMap((k) => sources.get(k) ?? [])
  const fresh = item.kind === 'new' ? sources.get(item.source ?? '') : undefined
  const decide = (decision: Decision) => onDecide(item.key, decision)
  const disagrees = disagreeing.length > 1

  return (
    <article className="cmp-detail" aria-label={inSheet ? undefined : 'Comparison item'}>
      <header className="cmp-detail-head">
        {/* In the sheet the sheet's own title names the item. */}
        {!inSheet && <h2 className="cmp-detail-title">{itemTitle(item, sources)}</h2>}
        <div className="cmp-detail-tags">
          <Badge tone={pill.tone} icon={pill.icon}>
            {pill.label}
          </Badge>
          {item.dismissed && <Badge tone="neutral">{'Dismissed'}</Badge>}
          <ConfidenceIndicator level={item.confidence} />
        </div>
      </header>

      <DecisionBar
        item={item}
        canChange={canChange}
        deciding={deciding}
        canPair={previousItems.length > 0}
        onAccept={() => void decide({ action: 'accept' })}
        onDismiss={() => void decide({ action: 'dismiss' })}
        onRestore={() => void decide({ action: 'restore' })}
        onChange={() => setDialog('outcome')}
        onRepair={() => setDialog('pair')}
        onPairNew={() => setDialog('pairNew')}
      />

      {item.recheck && (
        <Callout tone="warning" title="Look again">
          {item.recheck}
        </Callout>
      )}
      {disagrees && (
        <Callout tone="warning" title="Sources disagree">
          {`${disagreeing.map(sourceName).join(' and ')} say different things about this item, so the outcome is left to ${canChange ? 'you' : 'the assigned engineer'}.`}
        </Callout>
      )}

      {(item.severity || item.figures.length > 0) && (
        <section className="cmp-changed" aria-label="Measured change">
          <h3 className="cmp-label">{'What changed'}</h3>
          {item.severity && (
            <p className="cmp-severity">
              <SeverityMove severity={item.severity} />
            </p>
          )}
          {item.figures.length > 0 && (
            <table className="cmp-figures">
              <thead>
                <tr>
                  <th scope="col">{'Figure'}</th>
                  <th scope="col">{'Previous'}</th>
                  <th scope="col">{'Now'}</th>
                  <th scope="col">{'Difference'}</th>
                </tr>
              </thead>
              <tbody>
                {item.figures.map((f) => (
                  <tr key={`${f.name}|${f.source}`}>
                    <th scope="row">{f.name}</th>
                    <td data-label="Previous">{f.previous}</td>
                    <td data-label="Now">{f.current}</td>
                    <td data-label="Difference" className="cmp-figures-diff">
                      {f.difference ?? f.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <div className="cmp-evidence">
        <section className="cmp-col" aria-label="Previous report">
          <h3 className="cmp-col-head">
            <Icon name="history" size={14} />
            {'Previous report'}
          </h3>
          {item.previous ? (
            <>
              <p className="cmp-where">
                {[item.previous.section, item.previous.heading].filter(Boolean).join(' · ')}
              </p>
              <blockquote className="cmp-quote" dir="auto">
                {item.previous.quote}
              </blockquote>
              {item.previous.context && (
                <p className="cmp-context">
                  <strong>{'Observed then: '}</strong>
                  {item.previous.context}
                </p>
              )}
            </>
          ) : (
            <p className="cmp-empty">{'Not in the previous report: new since that survey.'}</p>
          )}
        </section>

        <section className="cmp-col" aria-label="This assessment">
          <h3 className="cmp-col-head">
            <Icon name="clipboard-check" size={14} />
            {'This assessment'}
          </h3>
          {item.reason && <p className="cmp-reason">{item.reason}</p>}
          {item.missing && (
            <p className="cmp-missing">
              <Icon name="circle-dashed" size={14} color="var(--graphite-500)" />
              <span>
                <strong>{'Evidence missing: '}</strong>
                {item.missing}
              </span>
            </p>
          )}
          {cited.length > 0 ? (
            <ul className="cmp-sources">
              {cited.map((s) => (
                <SourceRow
                  key={s.key}
                  source={s}
                  onOpen={() => onOpenSource(s)}
                  onUnpair={
                    canChange && item.kind === 'previous'
                      ? () => void decide({ action: 'unpair', sources: [s.key] })
                      : undefined
                  }
                  busy={deciding}
                />
              ))}
            </ul>
          ) : (
            !item.missing && (
              <p className="cmp-empty">{'No current evidence was compared with it.'}</p>
            )
          )}
        </section>
      </div>

      {possible.length > 0 && (
        <section className="cmp-possible" aria-label="Possible matches">
          <h3 className="cmp-label">{'May concern the same thing'}</h3>
          <p className="cmp-sub">{'Not a clear match, so not paired.'}</p>
          <ul className="cmp-sources">
            {possible.map((s) => (
              <SourceRow key={s.key} source={s} onOpen={() => onOpenSource(s)} busy={deciding} />
            ))}
          </ul>
        </section>
      )}

      {dialog === 'outcome' && (
        <OutcomeDialog item={item} onClose={() => setDialog(null)} onDecide={decide} />
      )}
      {dialog === 'pair' && (
        <PairDialog
          item={item}
          sources={[...sources.values()]}
          onClose={() => setDialog(null)}
          onDecide={decide}
        />
      )}
      {dialog === 'pairNew' && fresh && (
        <PairNewDialog
          source={fresh}
          previousItems={previousItems}
          onClose={() => setDialog(null)}
          onDecide={onDecide}
        />
      )}
    </article>
  )
}

const SEVERITY_TONE: Record<string, string> = {
  Critical: 'critical',
  High: 'high',
  Moderate: 'moderate',
  Low: 'low',
}

// The severity move as two severity badges with an arrow, or one with "as before".
function SeverityMove({ severity }: { severity: NonNullable<ComparisonItem['severity']> }) {
  const badge = (word: string) => <Badge tone={SEVERITY_TONE[word] ?? 'neutral'}>{word}</Badge>
  if (severity.direction === 0)
    return (
      <>
        {badge(severity.current)}
        <span className="cmp-sub">{'Severity as before'}</span>
      </>
    )
  return (
    <>
      {badge(severity.previous)}
      <Icon name="arrow-right" size={14} color="var(--graphite-500)" />
      <span className="ds-sr-only">{' to '}</span>
      {badge(severity.current)}
    </>
  )
}

function SourceRow({
  source,
  onOpen,
  onUnpair,
  busy,
}: {
  source: CurrentSource
  onOpen: () => void
  onUnpair?: () => void
  busy: boolean
}) {
  return (
    <li className="cmp-source">
      <div className="cmp-source-text">
        <span className="cmp-source-title">{sourceLabel(source)}</span>
        <span className="cmp-sub">
          {[
            source.severity && SEVERITY_LABEL[source.severity],
            source.priority,
            source.categories.join(', '),
            !source.current && 'Changed since this comparison',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="cmp-source-quote" dir="auto">
          {source.text}
        </span>
      </div>
      <div className="cmp-source-actions">
        <IconAction
          icon="arrow-up-right"
          label={`Open ${sourceLabel(source)}`}
          tooltip="Open source"
          onClick={onOpen}
        />
        {onUnpair && (
          <IconAction
            icon="x"
            label={`Unpair ${sourceLabel(source)}`}
            tooltip="Unpair"
            disabled={busy}
            onClick={onUnpair}
          />
        )}
      </div>
    </li>
  )
}
