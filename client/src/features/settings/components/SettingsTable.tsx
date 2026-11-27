// The standard table for Settings lists (PV-09 Privacy words): a card of 12/600 heads and 52 px
// rows, first column left and the rest centred (v2 section 2). Called by screens/PrivacyWordsSection.tsx.
// On a phone each row stacks its cells (settings.css `.st-pw-table`).
import type { ReactNode } from 'react'

export type SettingsColumn = { key: string; header: string; end?: boolean; width?: number }

/** Returns the table; `rows` hold one node per column key, and `empty` is shown when there are none. */
export function SettingsTable({
  columns,
  rows,
  empty,
}: {
  columns: SettingsColumn[]
  rows: Record<string, ReactNode>[]
  empty: string
}) {
  return (
    <div className="st-table-wrap st-pw-table">
      <table className="st-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-end={c.end || undefined} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="st-table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} data-end={c.end || undefined}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
