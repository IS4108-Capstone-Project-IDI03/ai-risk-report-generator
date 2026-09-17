import type * as React from 'react'

export type TableProps = {
  columns?: {
    key: string
    header: React.ReactNode
    align?: React.CSSProperties['textAlign']
    width?: React.CSSProperties['width']
    render?: (row: Record<string, React.ReactNode>) => React.ReactNode
  }[]
  rows?: Record<string, React.ReactNode>[]
  onRowClick?: (row: Record<string, React.ReactNode>) => void
  dense?: boolean
  emptyMessage?: string
  style?: React.CSSProperties
}
function Table({
  columns = [],
  rows = [],
  onRowClick,
  dense = false,
  emptyMessage = 'Nothing to show',
  style = {},
}: TableProps) {
  const pad = dense ? '6px 12px' : '10px 12px'
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--surface-card)',
        ...style,
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-body-size)',
        }}
      >
        <thead>
          <tr
            style={{
              background: 'var(--surface-header)',
            }}
          >
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align || 'left',
                  padding: pad,
                  width: c.width,
                  fontSize: 'var(--text-label-size)',
                  letterSpacing: 'var(--text-label-ls)',
                  textTransform: 'uppercase',
                  fontWeight: 'var(--text-label-weight)',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border-default)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: 'var(--space-9)',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr
                key={String(r.id || i)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onRowClick(r)
                  }
                }}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: pad,
                      textAlign: c.align || 'left',
                      color: 'var(--text-body)',
                      verticalAlign: 'middle',
                    }}
                  >
                    {c.render ? c.render(r) : r[c.key]}
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
export { Table }
