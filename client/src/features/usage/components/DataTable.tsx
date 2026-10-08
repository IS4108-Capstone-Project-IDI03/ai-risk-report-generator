// A small native table with a caption, for the Usage and costs screen (EV-04).
// The design-system Table has no caption, so screen readers could not name it.
import type { ReactNode } from 'react'

export type DataColumn<R> = { header: string; numeric?: boolean; cell: (row: R) => ReactNode }

export function DataTable<R extends { key: string }>({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: DataColumn<R>[]
  rows: R[]
}) {
  return (
    <div className="uc-table-wrap">
      <table className="uc-table">
        <caption>{caption}</caption>
        <thead>
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
            <tr key={row.key}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.header} scope="row">
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.header} data-numeric={c.numeric || undefined}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
