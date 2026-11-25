// A native table with a caption, for the Usage and costs screen (EV-04), drawn as the app's
// standard table (v2 section 2): one white card, an optional toolbar above and a count
// footer below. The design-system Table has no caption, so screen readers could not name it.
// On a phone each row becomes a card; every figure carries its heading as `data-label` (usage.css).
import type { ReactNode } from 'react'
import { TableFooter } from '../../../design-system'

export type DataColumn<R> = { header: string; numeric?: boolean; cell: (row: R) => ReactNode }

export function DataTable<R extends { key: string }>({
  caption,
  columns,
  rows,
  walk,
  toolbar,
  footer,
  empty,
}: {
  caption: string
  columns: DataColumn<R>[]
  rows: R[]
  // F-12: the walkthrough's tags for the headings and for the first row `isRow` accepts.
  walk?: { head: string; row: string; isRow: (row: R) => boolean }
  // Search and filters, in the card above the table.
  toolbar?: ReactNode
  // The count line under the table, e.g. "156 assessments".
  footer?: string
  // What to say when a search leaves no rows (the table is left out).
  empty?: string
}) {
  const target = walk ? rows.find(walk.isRow) : undefined
  return (
    <div className="uc-table-wrap">
      {toolbar && <div className="uc-table-toolbar">{toolbar}</div>}
      {empty && rows.length === 0 ? (
        <p className="uc-status" role="status">
          {empty}
        </p>
      ) : (
        <div className="uc-scroll">
          <table className="uc-table">
            <caption>{caption}</caption>
            <thead data-walk={walk?.head}>
              <tr>
                {columns.map((c) => (
                  <th key={c.header} scope="col" data-numeric={c.numeric || undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-walk={row === target ? walk?.row : undefined}>
                  {columns.map((c, i) =>
                    i === 0 ? (
                      <th key={c.header} scope="row">
                        {c.cell(row)}
                      </th>
                    ) : (
                      <td
                        key={c.header}
                        data-label={c.header}
                        data-numeric={c.numeric || undefined}
                      >
                        {c.cell(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer && <TableFooter>{footer}</TableFooter>}
    </div>
  )
}
