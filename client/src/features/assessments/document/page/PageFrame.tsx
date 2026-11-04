// The pages around the report's text in Marsh's page layout (RV-12): the
// cover, details page and contents before it (FrontPages), and, over the
// text, each page's edges, running header, footer with its page number and
// the gap to the next page (PageBands). None of it is in the editor, so none
// of it can be typed into (AC3); the details are read from the assessment
// each time it is drawn, so a corrected detail shows at once.
import {
  contentsPages,
  FOOTER_LINES,
  MARSH_LOGO,
  REPORT_TITLE,
  shownDetail,
  type ContentsEntry,
  type CoverDetails,
} from './frontMatter'
import { contentBottomOf, MARSH_GEOMETRY, MARSH_PAGE, roman, strideOf } from './geometry'
import type { PageLayoutState } from './PageLayout'

// The running header of every page after the cover: the report's title, and
// the client and site it is for.
function PageHeader({ details }: { details: CoverDetails }) {
  return (
    <div className="pg-header" aria-hidden="true">
      <span>{REPORT_TITLE}</span>
      <span className="pg-header-right">
        {shownDetail(details.client)}
        <br />
        {shownDetail(details.site)}
      </span>
    </div>
  )
}

// The footer, with the page's number where Marsh's template puts it (AC7).
function PageFooter({ folio }: { folio: string }) {
  return (
    <div className="pg-footer">
      <span aria-hidden="true">
        {FOOTER_LINES[0]}
        <br />
        {FOOTER_LINES[1]}
      </span>
      <span className="pg-folio" aria-label={`Page ${folio}`}>
        {folio}
      </span>
    </div>
  )
}

function Cover({ details }: { details: CoverDetails }) {
  return (
    <section className="pg-page pg-cover" aria-label="Cover">
      {MARSH_LOGO ? (
        <img className="pg-logo" src={MARSH_LOGO} alt="Marsh" />
      ) : (
        <p className="pg-wordmark">MARSH</p>
      )}
      <p className="pg-cover-title">{REPORT_TITLE}</p>
      <p className="pg-cover-address">{shownDetail(details.address)}</p>
      <p className="pg-cover-site">{shownDetail(details.site)}</p>
      <p className="pg-cover-date">{shownDetail(details.visitDate)}</p>
      <p className="pg-cover-foot">A business of Marsh McLennan</p>
    </section>
  )
}

// Marsh's page i: the client, then what was surveyed, by whom and when.
function DetailsPage({ details }: { details: CoverDetails }) {
  const rows: [string, string | null][] = [
    ['Location Surveyed', details.site],
    ['Address', details.address],
    ['Surveyed By', details.engineer],
    ['Survey Dates', details.visitDate],
    ['Survey Type', details.assessmentType],
    ['Report Reference', details.reference],
  ]
  return (
    <section className="pg-page" aria-label="Report details">
      <PageHeader details={details} />
      <div className="pg-text">
        <table className="pg-details">
          <thead>
            <tr>
              <th scope="col" colSpan={2}>
                {shownDetail(details.client)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{shownDetail(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PageFooter folio={roman(1)} />
    </section>
  )
}

function ContentsPage({
  entries,
  first,
  folio,
  details,
  onOpen,
}: {
  entries: ContentsEntry[]
  first: boolean
  folio: string
  details: CoverDetails
  onOpen: (entry: ContentsEntry) => void
}) {
  return (
    <section className="pg-page" aria-label={first ? 'Contents' : 'Contents, continued'}>
      <PageHeader details={details} />
      <div className="pg-text">
        {first && <p className="pg-contents-title">Contents</p>}
        <ol className="pg-contents">
          {entries.map((entry, i) => (
            <li key={`${entry.number}${entry.title}${i}`} className={`pg-toc-${entry.level}`}>
              <button type="button" className="pg-toc-link" onClick={() => onOpen(entry)}>
                {entry.number && <span className="pg-toc-number">{entry.number}</span>}
                <span className="pg-toc-title">{entry.title}</span>
                <span className="pg-toc-leader" aria-hidden="true" />
                <span className="pg-toc-page" aria-label={`page ${entry.page}`}>
                  {entry.page}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <PageFooter folio={folio} />
    </section>
  )
}

// The cover, details page and contents (AC2, AC5): the cover unnumbered,
// the others numbered i, ii, iii as Marsh's front matter is.
export function FrontPages({
  details,
  contents,
  onOpen,
}: {
  details: CoverDetails
  // Null until the pages have been laid out.
  contents: ContentsEntry[] | null
  onOpen: (entry: ContentsEntry) => void
}) {
  const pages = contents ? contentsPages(contents, MARSH_GEOMETRY.contentHeight) : null
  return (
    <>
      <Cover details={details} />
      <DetailsPage details={details} />
      {pages ? (
        pages.map((entries, i) => (
          <ContentsPage
            key={i}
            entries={entries}
            first={i === 0}
            folio={roman(i + 2)}
            details={details}
            onOpen={onOpen}
          />
        ))
      ) : (
        <section className="pg-page" aria-label="Contents">
          <div className="pg-text">
            <p className="pg-contents-title">Contents</p>
            <p role="status">Laying out the pages…</p>
          </div>
        </section>
      )}
    </>
  )
}

// What the pages draw over and under the report's text.
export function PageBands({ layout, details }: { layout: PageLayoutState; details: CoverDetails }) {
  const g = MARSH_GEOMETRY
  const stride = strideOf(g)
  const pages = Array.from({ length: layout.pages }, (_, k) => k)
  return (
    <>
      <div className="pg-sheets" aria-hidden="true">
        {pages.map((k) => (
          <div
            key={k}
            className="pg-sheet-page"
            style={{ top: k * stride, height: g.pageHeight }}
          />
        ))}
      </div>
      <div className="pg-bands">
        {pages.map((k) => {
          const pageTop = k * stride
          const pageBottom = pageTop + g.pageHeight
          const repeat = layout.repeats[k]
          const last = k === layout.pages - 1
          // Blank from where the page's text ends; on the last page, from
          // the foot of its text area.
          const end = last ? contentBottomOf(g, k) : (layout.ends[k] ?? contentBottomOf(g, k))
          const from = Math.min(Math.max(end, pageTop + g.contentTop), pageBottom)
          return (
            <div key={k}>
              <div
                className="pg-band"
                style={{ top: pageTop, height: g.contentTop + (repeat?.height ?? 0) }}
              >
                <PageHeader details={details} />
                {repeat && (
                  <div
                    className="pg-repeat"
                    aria-hidden="true"
                    style={{
                      top: g.contentTop,
                      left: MARSH_PAGE.marginX + repeat.left,
                      width: repeat.width,
                    }}
                    // A copy of the report's own table header (measure.ts).
                    dangerouslySetInnerHTML={{ __html: repeat.html }}
                  />
                )}
              </div>
              <div className="pg-band" style={{ top: from, height: pageBottom - from }}>
                <PageFooter folio={String(k + 1)} />
              </div>
              {!last && <div className="pg-gap" style={{ top: pageBottom, height: g.gap }} />}
            </div>
          )
        })}
      </div>
    </>
  )
}
