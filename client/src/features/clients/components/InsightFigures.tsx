// The Insights tab's headline figures (CP-29): five FigureTiles in one even row (three then two
// on a tablet, two to a row on a phone). Every number is the gateway's count; a tile's icon
// turns red or amber only when its figure needs attention. Called by screens/InsightsTab.
import { FigureTile, IconRegistry, type FigureTone } from '../../../design-system'
import type { ClientInsights } from '../api'
import { plural } from '../formatClient'

type Figure = { label: string; value: number; note: string; icon: string; tone: FigureTone }

function figuresOf({ totals }: ClientInsights): Figure[] {
  return [
    {
      label: 'Sites',
      value: totals.sites,
      note: plural(totals.assessments, 'assessment'),
      icon: IconRegistry.object.site,
      tone: 'neutral',
    },
    {
      label: 'Observations',
      value: totals.observations,
      note: totals.uncategorised ? `${totals.uncategorised} uncategorised` : 'All categorised',
      icon: 'camera',
      tone: totals.uncategorised ? 'warn' : 'neutral',
    },
    {
      label: 'Critical and High',
      value: totals.critical + totals.high,
      note: totals.critical ? `${totals.critical} Critical` : 'None Critical',
      icon: 'triangle-alert',
      tone: totals.critical ? 'danger' : 'neutral',
    },
    {
      label: 'Priority 1 and 2 OFIs',
      value: totals.ofisPriority12,
      note: `of ${totals.ofisAccepted} accepted`,
      icon: 'lightbulb',
      tone: 'neutral',
    },
    {
      label: 'Reports late',
      value: totals.reportsLate,
      note: totals.latest
        ? `${totals.latest.site}, ${plural(totals.latest.days, 'day')}`
        : 'None late',
      icon: totals.latest ? 'calendar-x' : 'calendar-check',
      tone: totals.latest ? 'danger' : 'neutral',
    },
  ]
}

export function InsightFigures({ insights }: { insights: ClientInsights }) {
  return (
    <ul className="ci-tiles" data-walk="insights.tiles" aria-label="Figures">
      {figuresOf(insights).map((figure) => (
        <li key={figure.label} className="ci-tile">
          <FigureTile {...figure} />
        </li>
      ))}
    </ul>
  )
}
