// The client page's Insights tab (CP-29): what the engineer's sites at the
// client add up to. Headline figures, what stands out, the written summary,
// the sites needing attention, where the findings are and how each site
// changed between visits. The gateway counts and words everything but the
// summary, which the model drafts on request. Called by ClientRecord; data from
// ../useClientInsights.ts.
import { useRef, useState } from 'react'
import { Button, EmptyState, Icon } from '../../../design-system'
import { CAT_ICON } from '../../assessments/categories'
import type { ClientInsights, InsightFinding } from '../api'
import { AttentionList } from '../components/AttentionList'
import { FindingsGrid } from '../components/FindingsGrid'
import { InsightSummaryCard } from '../components/InsightSummaryCard'
import { VisitChange } from '../components/VisitChange'
import { plural } from '../formatClient'
import type { Measure } from '../insights'
import { useClientInsights } from '../useClientInsights'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import '../insights.css'

type Tile = { label: string; value: number; note: string; tone?: 'danger' | 'warn' }

function tilesOf({ totals }: ClientInsights): Tile[] {
  return [
    { label: 'Sites', value: totals.sites, note: plural(totals.assessments, 'assessment') },
    {
      label: 'Observations',
      value: totals.observations,
      note: totals.uncategorised ? `${totals.uncategorised} uncategorised` : 'All categorised',
      tone: totals.uncategorised ? 'warn' : undefined,
    },
    {
      label: 'Critical and High',
      value: totals.critical + totals.high,
      note: totals.critical ? `${totals.critical} Critical` : 'None Critical',
      tone: totals.critical ? 'danger' : undefined,
    },
    {
      label: 'Priority 1 and 2 OFIs',
      value: totals.ofisPriority12,
      note: `of ${totals.ofisAccepted} accepted`,
    },
    {
      label: 'Reports late',
      value: totals.reportsLate,
      note: totals.latest
        ? `${totals.latest.site}, ${plural(totals.latest.days, 'day')}`
        : 'None late',
      tone: totals.latest ? 'danger' : undefined,
    },
  ]
}

// The space left above a block brought into view.
const GAP = 16

// Scrolls a block to the top of the page's own scroller (AssessmentApp's
// <main>), and nothing else. scrollIntoView would also move the app's frame,
// which is clipped rather than scrollable: when the block is near the end of
// the page it pushed the whole screen up and cut it off.
function bringIntoView(block: HTMLElement | null) {
  const scroller = block?.closest<HTMLElement>('.om-scroll')
  if (!block || !scroller) return
  const top =
    scroller.scrollTop +
    block.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    GAP
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scroller.scrollTo?.({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' })
}

const FINDING_ICON: Record<InsightFinding['kind'], string> = {
  category: 'layers',
  worse: 'trending-up',
  improved: 'trending-down',
  severe: 'triangle-alert',
}

export function InsightsTab({
  clientId,
  onOpen,
}: {
  clientId: string
  onOpen: (reference: string, site: string) => void
}) {
  const { insights, error, writing, failure, write } = useClientInsights(clientId, true)
  // The site chosen in the list, the category a finding points at, and the
  // measure the change chart shows.
  const [focus, setFocus] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [measure, setMeasure] = useState<Measure>('severity')
  const grid = useRef<HTMLElement>(null)
  const change = useRef<HTMLElement>(null)
  // F-12: ready once the figures have loaded; held back (no offer) while there is nothing to point at.
  useWalkthroughScreen('client-insights', !!insights, !insights || insights.empty)

  if (error && !insights)
    return (
      <div className="cl-card">
        <EmptyState
          icon="chart-column"
          title="The insights could not be loaded"
          description={error}
        />
      </div>
    )
  if (!insights)
    return (
      <p role="status" className="cl-empty-title">
        {'Loading insights…'}
      </p>
    )
  if (insights.empty)
    return (
      <div className="cl-card">
        <EmptyState
          icon="chart-column"
          title="Nothing to analyse yet"
          description="Insights appear once one of your assessments for this client has an observation."
        />
      </div>
    )

  // A finding's link lights what it is about and brings its block into view.
  const show = (finding: InsightFinding) => {
    const to = finding.kind === 'worse' || finding.kind === 'improved' ? change : grid
    setCategory(finding.category)
    setFocus(finding.siteId)
    if (to === change) setMeasure('severity')
    bringIntoView(to.current)
  }
  const focusSite = (id: string | null) => {
    setFocus(id)
    setCategory(null)
  }

  return (
    <div className="ci">
      <p className="ci-basis">
        {
          "Counted from each site's latest assessment with observations. Archived assessments and removed sites are left out."
        }
      </p>

      <dl className="ci-tiles" data-walk="insights.tiles">
        {tilesOf(insights).map((tile) => (
          <div key={tile.label} className="cl-card ci-tile">
            <dt>{tile.label}</dt>
            <dd className="ci-tile-value">{tile.value}</dd>
            <dd className="ci-tile-note" data-tone={tile.tone}>
              {tile.tone && <Icon name="triangle-alert" size={14} />}
              {tile.note}
            </dd>
          </div>
        ))}
      </dl>

      {insights.findings.length > 0 && (
        <section className="ci-block" aria-labelledby="ci-stands">
          <h2 id="ci-stands" className="ci-h">
            {'What stands out'}
          </h2>
          <ul className="ci-findings">
            {insights.findings.map((finding) => (
              <li key={finding.kind} className="cl-card ci-finding">
                <div className="ci-finding-head">
                  <span className="ci-tile-icon" data-tone={finding.tone} aria-hidden="true">
                    <Icon
                      name={
                        (finding.category && CAT_ICON[finding.category]) ||
                        FINDING_ICON[finding.kind]
                      }
                      size={18}
                    />
                  </span>
                  <h3>{finding.title}</h3>
                </div>
                <p>{finding.detail}</p>
                {finding.share && (
                  <span
                    className="ci-meter"
                    role="img"
                    aria-label={`${finding.share.count} of ${finding.share.total} observations`}
                  >
                    <span
                      style={{ width: `${(finding.share.count / finding.share.total) * 100}%` }}
                    />
                  </span>
                )}
                {finding.change && (
                  <span className="ci-move">
                    <span>{finding.change.from}</span>
                    <span aria-hidden="true">{'→'}</span>
                    <span className="cl-sr">{'to'}</span>
                    <strong>{finding.change.to}</strong>
                    {finding.change.period && (
                      <span className="ci-sub">{finding.change.period}</span>
                    )}
                  </span>
                )}
                <Button
                  variant="link"
                  size="sm"
                  className="ds-press ci-link"
                  onClick={() => show(finding)}
                >
                  {finding.kind === 'category'
                    ? 'Show in the grid'
                    : finding.kind === 'severe'
                      ? 'Show its findings'
                      : 'Show the change'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ci-row">
        <div className="ci-col ci-col--wide">
          <InsightSummaryCard
            summary={insights.summary}
            canSummarise={insights.canSummarise}
            writing={writing}
            failure={failure}
            onWrite={() => void write()}
          />
        </div>
        <section
          className="cl-card ci-card ci-col"
          aria-labelledby="ci-attention"
          data-walk="insights.attention"
        >
          <div className="ci-card-head">
            <h2 id="ci-attention" className="ci-h">
              {'Sites needing attention'}
            </h2>
            {focus && (
              <Button
                variant="link"
                size="sm"
                className="ds-press ci-link"
                onClick={() => focusSite(null)}
              >
                {'Show all sites'}
              </Button>
            )}
          </div>
          <p className="ci-sub">
            {'Ordered by Critical findings, then Priority 1 OFIs, then rating.'}
          </p>
          <AttentionList sites={insights.sites} focus={focus} onFocus={focusSite} onOpen={onOpen} />
        </section>
      </div>

      <div className="ci-row">
        <section
          ref={grid}
          className="cl-card ci-card ci-col ci-col--grid"
          aria-labelledby="ci-grid"
          data-walk="insights.grid"
        >
          <h2 id="ci-grid" className="ci-h">
            {'Where the findings are'}
          </h2>
          <p className="ci-sub">
            {"Observations at each site's latest assessment, by COPE category."}
          </p>
          <FindingsGrid
            sites={insights.sites}
            byCategory={insights.byCategory}
            focus={focus}
            category={category}
            onOpen={onOpen}
          />
        </section>
        <section
          ref={change}
          className="cl-card ci-card ci-col ci-col--change"
          aria-labelledby="ci-change"
          data-walk="insights.change"
        >
          <h2 id="ci-change" className="ci-h">
            {'Change between visits'}
          </h2>
          <VisitChange
            sites={insights.sites}
            focus={focus}
            measure={measure}
            onMeasure={setMeasure}
          />
        </section>
      </div>
    </div>
  )
}
