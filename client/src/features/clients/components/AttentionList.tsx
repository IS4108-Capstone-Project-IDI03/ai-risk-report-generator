// "Sites needing attention" on the Insights tab (CP-29): the client's sites,
// worst first, each with the reasons it sits there. Choosing a site keeps it lit
// in the grid and the change chart; the chevron opens the assessment its figures
// come from. Rows share their look with StandsOutList (.ci-item). Called by
// screens/InsightsTab.
import { Badge, IconAction, IconRegistry, IconTile } from '../../../design-system'
import type { InsightSite } from '../api'
import { country } from '../formatClient'
import { BADGE_TONE } from '../insights'

export function AttentionList({
  sites,
  focus,
  onFocus,
  onOpen,
}: {
  sites: InsightSite[]
  // The site chosen, or null.
  focus: string | null
  onFocus: (id: string | null) => void
  onOpen: (reference: string, site: string) => void
}) {
  return (
    <ol className="ci-list ci-rank">
      {sites.map((site, i) => {
        const on = focus === site.id
        return (
          <li
            key={site.id}
            className="ci-item"
            data-on={on || undefined}
            data-dim={(focus && !on) || undefined}
          >
            <button
              type="button"
              className="ci-rank-site"
              aria-pressed={on}
              onClick={() => onFocus(on ? null : site.id)}
            >
              <span className="ci-rank-n">{i + 1}</span>
              <IconTile icon={IconRegistry.object.site} />
              <span className="ci-item-text">
                <span className="ci-item-title ci-rank-name" dir="auto">
                  {site.name}
                </span>
                <span className="ci-item-sub">{`${site.facilityType} · ${country(site.jurisdiction)}`}</span>
                <span className="ci-reasons">
                  {site.reasons.map((r) => (
                    <Badge key={r.text} tone={BADGE_TONE[r.tone]}>
                      {r.text}
                    </Badge>
                  ))}
                </span>
              </span>
            </button>
            <IconAction
              icon="chevron-right"
              label={`Open ${site.reference} at ${site.name}`}
              tooltip="Open assessment"
              onClick={() => onOpen(site.reference, site.name)}
            />
          </li>
        )
      })}
    </ol>
  )
}
