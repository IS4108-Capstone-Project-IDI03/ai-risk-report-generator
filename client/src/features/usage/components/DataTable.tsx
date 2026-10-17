// A small native table with a caption, for the Usage and costs screen (EV-04).
// The design-system Table has no caption, so screen readers could not name it.
// With `expand`, each row gets a chevron that shows more beneath it; any number
// can be open at once, so two rows can be compared.
import { Fragment, useId, useState, type ReactNode } from 'react'
import { IconButton } from '../../../design-system'

export type DataColumn<R> = { header: string; numeric?: boolean; cell: (row: R) => ReactNode }

export type RowExpansion<R> = {
  // The chevron's accessible name, e.g. "Show cost calculation for RPT-1".
  label: (row: R) => string
  content: (row: R) => ReactNode
}

export function DataTable<R extends { key: string }>({
  caption,
  columns,
  rows,
  expand,
}: {
  caption: string
  columns: DataColumn<R>[]
  rows: R[]
  expand?: RowExpansion<R>
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const idBase = useId()
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })

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
          {rows.map((row, index) => {
            const isOpen = !!expand && open.has(row.key)
            const panelId = `${idBase}-${index}`
            return (
              <Fragment key={row.key}>
                <tr data-open={isOpen || undefined}>
                  {columns.map((c, i) =>
                    i === 0 ? (
                      <th key={c.header} scope="row">
                        {expand ? (
                          <span className="uc-row-name">
                            <IconButton
                              icon={isOpen ? 'chevron-down' : 'chevron-right'}
                              label={expand.label(row)}
                              size="sm"
                              aria-expanded={isOpen}
                              aria-controls={isOpen ? panelId : undefined}
                              onClick={() => toggle(row.key)}
                            />
                            <span>{c.cell(row)}</span>
                          </span>
                        ) : (
                          c.cell(row)
                        )}
                      </th>
                    ) : (
                      <td key={c.header} data-numeric={c.numeric || undefined}>
                        {c.cell(row)}
                      </td>
                    ),
                  )}
                </tr>
                {isOpen && (
                  <tr className="uc-expansion">
                    <td id={panelId} colSpan={columns.length}>
                      {expand.content(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
