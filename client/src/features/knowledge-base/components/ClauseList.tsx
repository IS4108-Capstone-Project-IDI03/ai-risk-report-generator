// The clauses page's list (IN-18): one card with New clause and a filter on top, then a row per
// clause with where it stands (Ready, To check, Not searchable) and a Try again for the last.
// Used by screens/ManualSections.tsx.
import { Button, IconButton, Tooltip } from '../../../design-system'
import { FilterMenu } from '../../clients/components/FilterMenu'
import type { ManualSection } from '../api'
import { SHOWN, type Show } from '../manualClauses'
import { TonePill } from './TonePill'

// Where a clause stands: in search as saved, copied and not yet checked, or not in search.
function ClauseState({ section: s }: { section: ManualSection }) {
  if (!s.indexed)
    return (
      <TonePill tone="red" icon="octagon-alert">
        Not searchable
      </TonePill>
    )
  if (!s.checked)
    return (
      <TonePill tone="amber" icon="triangle-alert">
        To check
      </TonePill>
    )
  return (
    <TonePill tone="green" icon="circle-check">
      Ready
    </TonePill>
  )
}

/** Returns the clause list card. */
export function ClauseList({
  sections,
  selected,
  dirty,
  show,
  onShow,
  onNew,
  onOpen,
  onRetry,
}: {
  sections: ManualSection[]
  selected: ManualSection | null
  // Whether the editor holds changes that are not saved: New clause then has something to clear.
  dirty: boolean
  show: Show
  onShow: (show: Show) => void
  onNew: () => void
  onOpen: (section: ManualSection) => void
  // Asks the gateway to put a clause back in search.
  onRetry: (section: ManualSection) => void
}) {
  const shown = sections.filter(SHOWN[show])
  return (
    <section className="kb-manual-list cl-card" aria-label="Clauses">
      <div className="kb-manual-list-head">
        <Button
          variant="secondary"
          size="sm"
          pill
          iconLeft="plus"
          disabled={!selected && !dirty}
          onClick={onNew}
        >
          New clause
        </Button>
        {sections.length > 0 && (
          <FilterMenu
            name="Clauses"
            anyLabel={`All clauses (${sections.length})`}
            choices={[
              {
                value: 'unchecked',
                label: `To check (${sections.filter(SHOWN.unchecked).length})`,
              },
              {
                value: 'failed',
                label: `Not searchable (${sections.filter(SHOWN.failed).length})`,
              },
            ]}
            value={show === 'all' ? '' : show}
            onChange={(value) => onShow((value || 'all') as Show)}
          />
        )}
      </div>
      {sections.length === 0 ? (
        <p className="kb-list-note">No clauses yet. Add the first one in the editor.</p>
      ) : shown.length === 0 ? (
        <p className="kb-list-note">None left. Choose All clauses to see the rest.</p>
      ) : (
        <ol className="kb-manual-rows">
          {shown.map((s) => (
            <li key={s.id} data-selected={selected?.id === s.id || undefined}>
              <button
                type="button"
                className="kb-manual-row"
                aria-current={selected?.id === s.id || undefined}
                onClick={() => onOpen(s)}
              >
                <strong>{s.clause}</strong>
                <span>{s.headings.at(-1) ?? s.text.slice(0, 80)}</span>
              </button>
              <span className="kb-manual-state">
                <ClauseState section={s} />
                {!s.indexed && (
                  <Tooltip label="Try again">
                    <IconButton
                      icon="rotate-ccw"
                      size="sm"
                      label={`Try ${s.clause} again`}
                      title={undefined}
                      style={{ borderRadius: 999, color: 'var(--graphite-600)' }}
                      onClick={() => onRetry(s)}
                    />
                  </Tooltip>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
