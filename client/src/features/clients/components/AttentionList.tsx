// "Sites needing attention" on the Insights tab (CP-29): the client's sites,
// worst first, each with the reasons it sits there. Choosing a site keeps it lit
// in the grid and the change chart; the chevron opens the assessment its figures
// come from. Called by screens/InsightsTab.
import { Icon, IconRegistry } from '../../../design-system'
import type { InsightSite } from '../api'
import { country } from '../formatClient'
import { RowAction } from './RowAction'

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
    <ol className="ci-rank">
      {sites.map((site, i) => {
        const on = focus === site.id
        return (
          <li key={site.id} data-on={on || undefined} data-dim={(focus && !on) || undefined}>
            <button
              type="button"
              className="ci-rank-site"
              aria-pressed={on}
              onClick={() => onFocus(on ? null : site.id)}
            >
              <span className="ci-rank-n">{i + 1}</span>
              <span className="ci-tile-icon" aria-hidden="true">
                <Icon name={IconRegistry.object.site} size={18} />
              </span>
              <span className="ci-rank-text">
                <span className="ci-rank-name" dir="auto">
                  {site.name}
                </span>
                <span className="ci-sub">{`${site.facilityType} · ${country(site.jurisdiction)}`}</span>
                <span className="ci-reasons">
                  {site.reasons.map((r) => (
                    <span key={r.text} className="ci-reason" data-tone={r.tone}>
                      {r.text}
                    </span>
                  ))}
                </span>
              </span>
            </button>
            <RowAction
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
