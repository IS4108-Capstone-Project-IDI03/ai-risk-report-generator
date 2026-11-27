// The assessment workspace's Comparison tab (RV-13): this assessment compared
// with the previous finalised report for the same site. The top card names the
// report compared against and sums up what changed (outcome tiles that filter,
// measured figures); under it the items list sits beside the open item (under
// it below 1080 px, in a bottom sheet below 760 px). Nothing here changes the
// report or its export. Called by AssessmentApp; data from useComparison.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, EmptyState, Sheet } from '../../../design-system'
import { PillFilter } from '../components/ObservationFilters'
import { useCompact } from '../useCompact'
import { scrollParent } from '../document/page/measure'
import type { CurrentSource } from './api'
import { ComparisonDetail } from './ComparisonDetail'
import { ComparisonRow } from './ComparisonRow'
import { ComparisonSummary } from './ComparisonSummary'
import {
  ALL,
  countTiles,
  filterChoices,
  filterItems,
  itemTitle,
  NO_FILTERS,
  shownLine,
  type Filters,
} from './comparisonDisplay'
import { useComparison } from './useComparison'
import './comparison.css'

const clock = (at: Date) =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

// How many changes the out-of-date note names before "and N more".
const NAMED_CHANGES = 5

export function ComparisonTab({
  reference,
  onViewObservation,
  onOpenSection,
}: {
  reference: string
  onViewObservation: (id: string) => void
  // A draft finding opens its section in Review; a draft OFI opens Section 3.
  onOpenSection: (sectionId: string) => void
}) {
  const c = useComparison(reference)
  const page = c.page
  const comparison = page?.comparison ?? null
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const stacked = useCompact(1079)
  const phone = useCompact(759)

  const sources = useMemo(
    () => new Map((comparison?.sources ?? []).map((s) => [s.key, s])),
    [comparison],
  )
  const shown = useMemo(
    () => (comparison ? filterItems(comparison.items, filters) : []),
    [comparison, filters],
  )
  const total = comparison ? comparison.items.filter((i) => !i.dismissed).length : 0
  const previousItems = useMemo(
    () => (comparison?.items ?? []).filter((i) => i.kind === 'previous'),
    [comparison],
  )
  // Side by side, an item is always open: the one chosen, else the first shown.
  const open =
    shown.find((i) => i.key === openKey) ??
    (stacked ? undefined : shown[0]) ??
    comparison?.items.find((i) => i.key === openKey)

  // A new comparison (Compare again, or another report picked) starts with no filter and
  // nothing chosen; deciding an item keeps both. Set while rendering, as React advises for
  // state that follows a prop.
  const [shownId, setShownId] = useState<string | null>(null)
  if ((comparison?.id ?? null) !== shownId) {
    setShownId(comparison?.id ?? null)
    setFilters(NO_FILTERS)
    setOpenKey(null)
  }
  // A chip whose count fell to 0 (the last dismissed item restored) disappears, so its
  // filter lapses too: without this the list stays empty with no chip left to clear it.
  if (
    comparison &&
    filters.outcome !== ALL &&
    !countTiles(comparison.counts).some((t) => t.key === filters.outcome)
  )
    setFilters((f) => ({ ...f, outcome: ALL }))

  // Stacked, the item opens under the list: bring it into view.
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openKey || !stacked || phone) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // Scrolls only the list's own scroller: scrollIntoView also moved the app frame round it
    // (overflow hidden), shifting the sidebar and header up and leaving a blank band below.
    const el = panel.current
    if (!el) return
    const scroller = scrollParent(el)
    scroller.scrollTo?.({
      top:
        scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      behavior: still ? 'auto' : 'smooth',
    })
  }, [openKey, stacked, phone])

  const openSource = (s: CurrentSource) => {
    if (s.observationId) onViewObservation(s.observationId)
    else if (s.sectionId) onOpenSection(s.sectionId)
  }

  if (!page)
    return (
      <div className="cmp">
        {c.error ? (
          <Callout tone="danger" title="Comparison not loaded">
            {c.error}
          </Callout>
        ) : (
          <p className="cmp-sub" role="status">
            {'Loading the comparison…'}
          </p>
        )}
      </div>
    )

  const failure =
    c.failure ?? (page.failure && { message: page.failure.error, at: new Date(page.failure.at) })
  const running = c.running || page.running
  const noObservation = page.observations === 0

  const outcomeTile = comparison
    ? countTiles(comparison.counts).find((t) => t.key === filters.outcome)
    : undefined

  // Filters hold "all" when unset; the pills hold '' (PillFilter clears to '').
  const choices = comparison ? filterChoices(comparison.items) : null
  const pill = (name: string, key: 'category' | 'severity' | 'location') => (
    <PillFilter
      name={name}
      choices={choices?.[key] ?? []}
      value={filters[key] === ALL ? '' : filters[key]}
      onChoose={(value) => setFilters((f) => ({ ...f, [key]: value || ALL }))}
    />
  )

  return (
    <div className="cmp">
      {page.previous && (
        <ComparisonSummary
          page={page}
          comparison={comparison}
          running={running}
          outcome={filters.outcome}
          onOutcome={(key) =>
            setFilters((f) => ({ ...f, outcome: f.outcome === key ? NO_FILTERS.outcome : key }))
          }
          onRun={() => void c.run()}
          onPick={c.pick}
          onOpenItem={(key) => {
            // A measured figure's item may be filtered out: clear the filters so it shows.
            setFilters(NO_FILTERS)
            setOpenKey(key)
          }}
        />
      )}

      {!page.previous && (
        <section className="cmp-card">
          <EmptyState
            icon="file-check"
            title="No earlier finalised report for this site"
            description="A comparison becomes available once an earlier assessment of this site has its report finalised."
          />
        </section>
      )}

      {failure && !running && (
        <Callout
          tone="danger"
          title={`Comparison stopped at ${clock(failure.at)}`}
          actions={
            page.canChange ? (
              <Button size="sm" variant="secondary" onClick={() => void c.run()}>
                {'Retry'}
              </Button>
            ) : undefined
          }
        >
          {comparison ? `${failure.message} The last comparison is still shown.` : failure.message}
        </Callout>
      )}

      {running && (
        <div className="cmp-card cmp-running" role="status">
          <span className="cmp-running-line">
            <span className="cmp-pulse" aria-hidden="true" />
            {'Comparing with the previous report…'}
          </span>
        </div>
      )}

      {page.previous && !comparison && !running && !failure && (
        <section className="cmp-card">
          <EmptyState
            icon="git-compare"
            title="Not compared yet"
            description={
              noObservation
                ? 'Save at least one observation, then you can compare with the previous report.'
                : page.canChange
                  ? 'Compare with the previous report to see what was fixed, what got worse and what is new.'
                  : 'The assigned engineer has not compared this assessment with that report yet.'
            }
          />
        </section>
      )}

      {comparison && (
        <>
          {comparison.outOfDate && (
            <Callout tone="warning" title="Out of date">
              <p className="cmp-callout-line">
                {`${comparison.outOfDate.summary} since this comparison ran.`}
                {page.canChange &&
                  ' Compare again keeps your decisions on items whose evidence is unchanged and flags the rest for another look.'}
              </p>
              <details className="cmp-changes">
                <summary>{'What changed'}</summary>
                <ul>
                  {comparison.outOfDate.changes.slice(0, NAMED_CHANGES).map((ch, n) => (
                    <li key={n}>{`${CHANGE_WORD[ch.change]}: ${ch.label}`}</li>
                  ))}
                  {comparison.outOfDate.changes.length > NAMED_CHANGES && (
                    <li>{`and ${comparison.outOfDate.changes.length - NAMED_CHANGES} more`}</li>
                  )}
                </ul>
              </details>
            </Callout>
          )}

          <div className="cmp-body" data-stacked={stacked || undefined}>
            <section className="cmp-card cmp-listcard" aria-label="Comparison items">
              <div className="cmp-list-head">
                <h2 className="cmp-title">{outcomeTile?.label ?? 'All items'}</h2>
                {outcomeTile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    pill
                    onClick={() => setFilters((f) => ({ ...f, outcome: ALL }))}
                  >
                    {'Show all'}
                  </Button>
                )}
              </div>
              <div className="cmp-toolbar" role="group" aria-label="Filter the items">
                {pill('Category', 'category')}
                {pill('Severity', 'severity')}
                {pill('Location', 'location')}
              </div>
              <ol className="cmp-list" aria-label="Comparison items">
                {shown.length === 0 && (
                  <li className="cmp-none">{'No item matches these filters.'}</li>
                )}
                {shown.map((item) => (
                  <ComparisonRow
                    key={item.key}
                    item={item}
                    sources={sources}
                    open={open?.key === item.key}
                    onOpen={() => setOpenKey(item.key)}
                  />
                ))}
              </ol>
              <p className="cmp-foot" aria-live="polite">
                <span>
                  {shownLine(shown.length, filters.outcome === 'dismissed' ? shown.length : total)}
                </span>
                <span>{comparison.summary}</span>
              </p>
            </section>
            {open && !phone && (
              <div className="cmp-card cmp-panel" ref={panel}>
                <ComparisonDetail
                  key={open.key}
                  item={open}
                  sources={sources}
                  previousItems={previousItems}
                  canChange={page.canChange}
                  deciding={c.deciding}
                  onDecide={c.decide}
                  onOpenSource={openSource}
                />
              </div>
            )}
          </div>
          {phone && (
            <Sheet
              open={!!openKey && !!open}
              onClose={() => setOpenKey(null)}
              title={open ? itemTitle(open, sources) : 'Comparison item'}
              className="cmp-sheet"
            >
              {open && (
                <ComparisonDetail
                  key={open.key}
                  item={open}
                  sources={sources}
                  previousItems={previousItems}
                  canChange={page.canChange}
                  deciding={c.deciding}
                  onDecide={c.decide}
                  onOpenSource={openSource}
                  inSheet
                />
              )}
            </Sheet>
          )}
        </>
      )}
    </div>
  )
}

const CHANGE_WORD = {
  added: 'Added',
  deleted: 'Deleted',
  retagged: 'Retagged',
  edited: 'Edited',
  changed: 'Draft finding changed',
} as const
