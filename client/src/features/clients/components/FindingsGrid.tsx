// "Where the findings are" on the Insights tab (CP-29): a table of sites by
// COPE category, each cell shaded by how many observations it holds (one blue,
// more is darker) with its count printed, so nothing is read from colour
// alone. Pointing at or choosing a cell says how severe they are. Called by
// screens/InsightsTab; shades and wording from ../insights.ts.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system'
import type { InsightCell, InsightSite } from '../api'
import { categoryName, cellText, heatStep } from '../insights'

type Chosen = { site: string; column: number }

export function FindingsGrid({
  sites,
  byCategory,
  focus,
  category,
  onOpen,
}: {
  sites: InsightSite[]
  byCategory: InsightCell[]
  // The site chosen in the list: the others dim.
  focus: string | null
  // A category a finding points at: its column is ringed.
  category: string | null
  onOpen: (reference: string, site: string) => void
}) {
  const [pinned, setPinned] = useState<Chosen | null>(null)
  const [hover, setHover] = useState<Chosen | null>(null)
  const max = Math.max(0, ...sites.flatMap((s) => s.cells.map((c) => c.count)))
  const shown = hover ?? pinned
  const site = shown && sites.find((s) => s.id === shown.site)
  const pinnedSite = pinned && sites.find((s) => s.id === pinned.site)
  const scroll = useRef<HTMLDivElement>(null)

  // On a narrow screen the grid scrolls sideways: a finding's column is scrolled into view, or
  // "Show in the grid" would ring a column off the edge.
  useEffect(() => {
    const box = scroll.current
    const head = box?.querySelector<HTMLElement>('thead th[data-on]')
    const names = box?.querySelector<HTMLElement>('thead th:first-child')
    if (!box || !head || !names || box.scrollWidth <= box.clientWidth) return
    // Centred in the room right of the site names, which stay pinned at the left.
    const room = box.clientWidth - names.offsetWidth
    const left = head.offsetLeft - names.offsetWidth - (room - head.offsetWidth) / 2
    box.scrollTo?.({ left: Math.max(0, left) })
  }, [category])

  return (
    <>
      <div ref={scroll} className="ci-scroll">
        <table className="ci-grid" onMouseLeave={() => setHover(null)}>
          <caption className="cl-sr">
            {"Observations at each site's latest assessment, by COPE category"}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="cl-sr">{'Site'}</span>
              </th>
              {byCategory.map((c) => (
                <th
                  key={categoryName(c.category)}
                  scope="col"
                  title={categoryName(c.category)}
                  data-on={(category && c.category === category) || undefined}
                >
                  {categoryName(c.category)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} data-dim={(focus && focus !== s.id) || undefined}>
                <th scope="row" title={s.name}>
                  <span className="cl-clamp" dir="auto">
                    {s.name}
                  </span>
                </th>
                {s.cells.map((cell, column) => {
                  const here = { site: s.id, column }
                  const on = pinned?.site === s.id && pinned.column === column
                  return (
                    <td key={column}>
                      <button
                        type="button"
                        className="ci-cell"
                        data-step={heatStep(cell.count, max)}
                        data-ring={on || (!!category && cell.category === category) || undefined}
                        aria-label={cellText(s.name, cell)}
                        aria-pressed={on}
                        onMouseEnter={() => setHover(here)}
                        onFocus={() => setHover(here)}
                        onBlur={() => setHover(null)}
                        onClick={() => setPinned(on ? null : here)}
                      >
                        {cell.count}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{'All sites'}</th>
              {byCategory.map((c) => (
                <td key={categoryName(c.category)}>{c.count}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="ci-grid-foot">
        <div className="ci-scale" aria-hidden="true">
          <span>{'Fewer'}</span>
          <span className="ci-scale-steps">
            {[1, 3, 4, 6, 7].map((step) => (
              <span key={step} className="ci-cell" data-step={step} />
            ))}
          </span>
          <span>{'More'}</span>
        </div>
        <div className="ci-readout">
          <span>
            {site && shown
              ? cellText(site.name, site.cells[shown.column])
              : 'Point at a cell, or choose one, to see how severe its observations are.'}
          </span>
          {pinnedSite && (
            <Button
              size="sm"
              variant="secondary"
              pill
              onClick={() => onOpen(pinnedSite.reference, pinnedSite.name)}
            >
              {'Open assessment'}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
