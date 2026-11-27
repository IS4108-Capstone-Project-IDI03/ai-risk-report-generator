// The decision bar at the top of an opened comparison item (RV-13): one line saying where the
// outcome stands (suggested, the engineer's to choose, or decided by whom), and the decision
// actions beside it: Accept, Change outcome (or Pair with previous item for a New one), Re-pair
// and Dismiss; Restore once dismissed. Called by ComparisonDetail, which opens the dialogs.
import { Button, Icon, IconAction } from '../../../design-system'
import type { ComparisonItem } from './api'
import { decidedLine } from './comparisonDisplay'

type Props = {
  item: ComparisonItem
  canChange: boolean
  deciding: boolean
  // Every previous item can be paired with; none means a New item has nothing to pair with.
  canPair: boolean
  onAccept: () => void
  onDismiss: () => void
  onRestore: () => void
  onChange: () => void
  onRepair: () => void
  onPairNew: () => void
}

// Where the outcome stands, in one sentence.
function stateLine(item: ComparisonItem, canChange: boolean) {
  if (item.decided) return decidedLine(item.decided)
  if (!canChange)
    return 'Suggested by the comparison. The assigned engineer has not decided it yet.'
  if (item.outcome) return 'Suggested by the comparison. Accept it or change it.'
  return 'No outcome is suggested, so choose one with Change outcome.'
}

export function DecisionBar({
  item,
  canChange,
  deciding,
  canPair,
  onAccept,
  onDismiss,
  onRestore,
  onChange,
  onRepair,
  onPairNew,
}: Props) {
  const decided = !!item.decided
  return (
    <div className="cmp-decision" data-decided={decided || undefined}>
      <div className="cmp-decision-top">
        <p className="cmp-decision-line">
          <Icon
            name={decided ? 'circle-check' : item.outcome ? 'sparkles' : 'triangle-alert'}
            size={16}
            color={
              decided
                ? 'var(--green-600)'
                : item.outcome
                  ? 'var(--ai-fg)'
                  : 'var(--status-moderate-fg)'
            }
          />
          <span>{stateLine(item, canChange)}</span>
        </p>
        {/* The quieter decisions sit in the bar's corner, so the pills below keep a full row. */}
        {canChange && !item.dismissed && (
          <span className="cmp-actions-icons">
            {item.kind === 'previous' && (
              <IconAction
                icon="link"
                label="Re-pair"
                tooltip="Re-pair"
                disabled={deciding}
                onClick={onRepair}
              />
            )}
            <IconAction
              icon="archive"
              label="Dismiss this item"
              tooltip="Dismiss"
              disabled={deciding}
              onClick={onDismiss}
            />
          </span>
        )}
      </div>
      {item.decided?.note && (
        <p className="cmp-note">
          <strong>{'Note: '}</strong>
          {item.decided.note}
        </p>
      )}
      {canChange && (
        <div className="cmp-actions">
          {item.dismissed ? (
            <Button
              variant="secondary"
              pill
              iconLeft="archive-restore"
              disabled={deciding}
              onClick={onRestore}
            >
              {'Restore'}
            </Button>
          ) : (
            <>
              {/* Once decided there is nothing left to accept: a second press would only repeat it. */}
              {!decided && (
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
                  onClick={onAccept}
                >
                  {'Accept'}
                </Button>
              )}
              {item.kind === 'previous' ? (
                <Button
                  variant="secondary"
                  pill
                  iconLeft="pencil"
                  disabled={deciding}
                  onClick={onChange}
                >
                  {'Change outcome'}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  pill
                  iconLeft="link"
                  disabled={deciding || !canPair}
                  onClick={onPairNew}
                >
                  {'Pair with previous item'}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
