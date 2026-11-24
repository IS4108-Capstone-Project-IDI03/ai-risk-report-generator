// One comparison item opened (RV-13): the previous report's words quoted with
// their section, the current evidence it was compared with (each opening its
// source), the severity and figures on both sides, the confidence, and the
// engineer's decision. Shown beside the list, under it below 1080 px, and in a
// bottom sheet below 760 px (ComparisonTab decides). Calls the dialogs in
// DecisionDialogs.tsx; decisions go up through `onDecide`.
import { useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  ConfidenceIndicator,
  IconButton,
  ViewOnlyChip,
} from '../../../design-system'
import type { ComparisonItem, CurrentSource, Decision } from './api'
import {
  decidedLine,
  outcomePill,
  SEVERITY_LABEL,
  sourceLabel,
  sourceName,
} from './comparisonDisplay'
import { OutcomeDialog, PairDialog, PairNewDialog } from './DecisionDialogs'
import type { DecisionRefusal } from './useComparison'

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

  return (
    <article className="cmp-detail" aria-label={inSheet ? undefined : 'Comparison item'}>
      <header className="cmp-detail-head">
        <Badge tone={pill.tone} icon={pill.icon}>
          {pill.label}
        </Badge>
        <ConfidenceIndicator level={item.confidence} />
        {item.dismissed && <Badge tone="neutral">{'Dismissed'}</Badge>}
        {!canChange && <ViewOnlyChip />}
      </header>
      <p className="cmp-sub">
        {item.decided
          ? decidedLine(item.decided)
          : !canChange
            ? 'Suggested by the comparison; the assigned engineer has not decided it yet.'
            : item.outcome
              ? 'Suggested by the comparison. Accept it or change it.'
              : 'The current evidence disagrees, so the outcome is yours to choose.'}
      </p>
      {item.decided?.note && (
        <p className="cmp-note">
          <strong>{'Note: '}</strong>
          {item.decided.note}
        </p>
      )}

      {item.recheck && (
        <Callout tone="warning" title="Look again">
          {item.recheck}
        </Callout>
      )}
      {disagreeing.length > 1 && (
        <Callout tone="warning" title="Sources disagree">
          {`${disagreeing.map(sourceName).join(' and ')} say different things about this item, so confidence is at most medium and the outcome is left to ${canChange ? 'you' : 'the assigned engineer'}.`}
        </Callout>
      )}

      <section className="cmp-side" aria-label="Previous report">
        <h3 className="cmp-label">{'Previous report'}</h3>
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
          <p className="cmp-empty">
            {'Not in the previous report: this is new since that survey.'}
          </p>
        )}
      </section>

      {(item.severity || item.figures.length > 0) && (
        <section className="cmp-side" aria-label="Measured change">
          <h3 className="cmp-label">{'What changed'}</h3>
          {item.severity && (
            <p className="cmp-severity">
              <span>{item.severity.previous}</span>
              <span aria-hidden="true">{' → '}</span>
              <span className="ds-sr-only">{' to '}</span>
              <span>{item.severity.current}</span>
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
                    <td>{f.previous}</td>
                    <td>{f.current}</td>
                    <td>{f.difference ?? f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="cmp-side" aria-label="This assessment">
        <h3 className="cmp-label">{'This assessment'}</h3>
        {item.reason && <p className="cmp-reason">{item.reason}</p>}
        {item.missing && (
          <p className="cmp-missing">
            <strong>{'Evidence missing: '}</strong>
            {item.missing}
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

      {possible.length > 0 && (
        <section className="cmp-side" aria-label="Possible matches">
          <h3 className="cmp-label">{'May concern the same thing'}</h3>
          <p className="cmp-sub">
            {'Not a clear match, so listed apart rather than paired on a guess.'}
          </p>
          <ul className="cmp-sources">
            {possible.map((s) => (
              <SourceRow key={s.key} source={s} onOpen={() => onOpenSource(s)} busy={deciding} />
            ))}
          </ul>
        </section>
      )}

      {canChange && (
        <div className="cmp-actions">
          {item.dismissed ? (
            <Button
              variant="secondary"
              pill
              iconLeft="archive-restore"
              disabled={deciding}
              onClick={() => void decide({ action: 'restore' })}
            >
              {'Restore'}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                pill
                iconLeft="check"
                disabled={deciding}
                disabledReason={
                  item.outcome
                    ? undefined
                    : {
                        title: 'Choose an outcome first',
                        text: 'Its sources disagree, so the outcome is yours to choose.',
                      }
                }
                onClick={() => void decide({ action: 'accept' })}
              >
                {'Accept'}
              </Button>
              {item.kind === 'previous' ? (
                <>
                  <Button
                    variant="secondary"
                    pill
                    iconLeft="pencil"
                    disabled={deciding}
                    onClick={() => setDialog('outcome')}
                  >
                    {'Change outcome'}
                  </Button>
                  <Button
                    variant="secondary"
                    pill
                    iconLeft="link"
                    disabled={deciding}
                    onClick={() => setDialog('pair')}
                  >
                    {'Re-pair'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  pill
                  iconLeft="link"
                  disabled={deciding || !previousItems.length}
                  onClick={() => setDialog('pairNew')}
                >
                  {'Pair with previous item'}
                </Button>
              )}
              <IconButton
                icon="archive"
                label="Dismiss this item"
                tooltip="Dismiss"
                disabled={deciding}
                onClick={() => void decide({ action: 'dismiss' })}
              />
            </>
          )}
        </div>
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
        <IconButton
          icon="arrow-up-right"
          label={`Open ${sourceLabel(source)}`}
          tooltip="Open source"
          onClick={onOpen}
        />
        {onUnpair && (
          <IconButton
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
