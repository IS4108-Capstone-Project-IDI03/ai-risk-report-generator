// The client page's Insights tab (CP-29): what the engineer's sites at the
// client add up to, read top to bottom: the checked AI summary, the headline
// figures, then what stands out beside the sites needing attention, then where
// the findings are beside how each site changed between visits. The gateway
// counts and words everything but the summary, which the model drafts on
// request. Called by ClientRecord; data from ../useClientInsights.ts.
import { useRef, useState } from 'react'
import { Button, EmptyNote, EmptyState, ListCard, Panel } from '../../../design-system'
import type { InsightFinding } from '../api'
import { AttentionList } from '../components/AttentionList'
import { FindingsGrid } from '../components/FindingsGrid'
import { InsightFigures } from '../components/InsightFigures'
import { InsightSummaryCard } from '../components/InsightSummaryCard'
import { StandsOutList } from '../components/StandsOutList'
import { VisitChange } from '../components/VisitChange'
import type { Measure } from '../insights'
import { useClientInsights } from '../useClientInsights'
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import '../insights.css'

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
      <ListCard>
        <EmptyState
          icon="chart-column"
          title="The insights could not be loaded"
          description={error}
        />
      </ListCard>
    )
  if (!insights)
    return (
      <EmptyNote centred status>
        {'Loading insights…'}
      </EmptyNote>
    )
  if (insights.empty)
    return (
      <ListCard>
        <EmptyState
          icon="chart-column"
          title="Nothing to analyse yet"
          description="Insights appear once one of your assessments for this client has an observation."
        />
      </ListCard>
    )

  // A finding's action lights what it is about and brings its block into view.
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

      {/* 1. The checked summary: the one AI-written block. */}
      <InsightSummaryCard
        summary={insights.summary}
        canSummarise={insights.canSummarise}
        writing={writing}
        failure={failure}
        onWrite={() => void write()}
      />

      {/* 2. The gateway's figures. */}
      <InsightFigures insights={insights} />

      {/* 3. What stands out, beside the sites it is about. */}
      <div className="ci-pair">
        {insights.findings.length > 0 && (
          <Panel title="What stands out" className="ci-panel">
            <StandsOutList findings={insights.findings} onShow={show} />
          </Panel>
        )}
        <Panel
          title="Sites needing attention"
          note="Ordered by Critical findings, then Priority 1 OFIs, then rating."
          className="ci-panel"
          data-walk="insights.attention"
          actions={
            focus && (
              <Button
                variant="link"
                size="sm"
                className="ds-press ci-link"
                onClick={() => focusSite(null)}
              >
                {'Show all sites'}
              </Button>
            )
          }
        >
          <AttentionList sites={insights.sites} focus={focus} onFocus={focusSite} onOpen={onOpen} />
        </Panel>
      </div>

      {/* 4. The two charts: where the findings are, and how each site moved. */}
      <div className="ci-pair ci-pair--charts">
        <Panel
          ref={grid}
          title="Where the findings are"
          note="Observations at each site's latest assessment, by COPE category."
          className="ci-panel"
          data-walk="insights.grid"
        >
          <FindingsGrid
            sites={insights.sites}
            byCategory={insights.byCategory}
            focus={focus}
            category={category}
            onOpen={onOpen}
          />
        </Panel>
        <Panel
          ref={change}
          title="Change between visits"
          note="Each site's first visit against its latest."
          className="ci-panel"
          data-walk="insights.change"
        >
          <VisitChange
            sites={insights.sites}
            focus={focus}
            measure={measure}
            onMeasure={setMeasure}
          />
        </Panel>
      </div>
    </div>
  )
}
