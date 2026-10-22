// Section 5's Values table (GN-03), as one table laid out like Marsh's template
// (p. 12): Date of Values and Currency across the top, then Property Damage items
// beside Time Element items, their totals, and the TIV. Rows start as the
// template's; the engineer renames, adds or removes them to suit the site. Totals
// are the gateway's, as last saved. Used by LossEstimateFigures.tsx.
import { Button, IconButton, Input } from '../../../design-system'
import { formatAmount } from '../reportFigures'

export type TypedValue = { key: string; item: string; value: string }
export type TypedValues = {
  currency: string
  dateOfValues: string
  indemnityMonths: string
  pd: TypedValue[]
  te: TypedValue[]
}

const amount = (text: string) => formatAmount(text === '' ? null : Number(text))

export function LossValuesTable({
  typed,
  totals,
  canEdit,
  onChange,
  problem,
}: {
  typed: TypedValues
  // As last saved; null while any value is not entered.
  totals: { pd: number | null; te: number | null; tiv: number | null }
  canEdit: boolean
  onChange: (change: Partial<TypedValues>) => void
  // What is wrong with a box, by key ("value:<row key>", "currency", "indemnity"),
  // shown in red under it as the engineer types (LossEstimateFigures' figureProblems).
  problem?: (key: string) => string | undefined
}) {
  // One side's item and value cells for row i; empty cells where that side has fewer rows.
  const cells = (side: 'pd' | 'te', i: number) => {
    const rows = typed[side]
    const row = rows[i]
    if (!row) return [<td key={`${side}-item`} />, <td key={`${side}-value`} />]
    const set = (change: Partial<TypedValue>) =>
      onChange({ [side]: rows.map((r, j) => (i === j ? { ...r, ...change } : r)) })
    const name = row.item || `Item ${i + 1}`
    return [
      <td key={`${side}-item`}>
        {canEdit ? (
          <div className="rv-figures-item">
            <Input
              size="sm"
              aria-label={`${side === 'pd' ? 'Property damage' : 'Time element'} item ${i + 1}`}
              value={row.item}
              onChange={(e) => set({ item: e.target.value })}
            />
            <IconButton
              icon="trash-2"
              label={`Remove ${name}`}
              size="sm"
              onClick={() => onChange({ [side]: rows.filter((_, j) => j !== i) })}
            />
          </div>
        ) : (
          <strong>{row.item}</strong>
        )}
      </td>,
      <td key={`${side}-value`}>
        {canEdit ? (
          <Input
            size="sm"
            type="number"
            min={0}
            aria-label={`${name} value`}
            error={problem?.(`value:${row.key}`)}
            value={row.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        ) : (
          amount(row.value)
        )}
      </td>,
    ]
  }
  // Not crypto.randomUUID: it exists only over HTTPS or on localhost.
  const add = (side: 'pd' | 'te') =>
    onChange({
      [side]: [
        ...typed[side],
        { key: `v-${Date.now().toString(36)}${typed[side].length}`, item: '', value: '' },
      ],
    })
  const lines = Math.max(typed.pd.length, typed.te.length)

  return (
    <div className="rv-maturity-scroll">
      <table className="rv-maturity-table rv-figures-table rv-values-table" aria-label="Values">
        <thead>
          <tr>
            <th scope="colgroup" colSpan={3}>
              <label className="rv-values-head">
                Date of Values:
                {canEdit ? (
                  <Input
                    size="sm"
                    type="date"
                    value={typed.dateOfValues}
                    onChange={(e) => onChange({ dateOfValues: e.target.value })}
                  />
                ) : (
                  ` ${typed.dateOfValues || '–'}`
                )}
              </label>
            </th>
            <th scope="col">
              <label className="rv-values-head">
                Currency:
                {canEdit ? (
                  <Input
                    size="sm"
                    placeholder="SGD"
                    maxLength={3}
                    error={problem?.('currency')}
                    value={typed.currency}
                    onChange={(e) => onChange({ currency: e.target.value })}
                  />
                ) : (
                  ` ${typed.currency || '–'}`
                )}
              </label>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="colgroup" colSpan={2}>
              Property Damage (PD) Values
            </th>
            <th scope="colgroup" colSpan={2}>
              Time Element (TE) Values
              <label className="rv-values-period">
                Indemnity Period (months)
                {canEdit ? (
                  <Input
                    size="sm"
                    type="number"
                    min={1}
                    max={120}
                    error={problem?.('indemnity')}
                    value={typed.indemnityMonths}
                    onChange={(e) => onChange({ indemnityMonths: e.target.value })}
                  />
                ) : (
                  ` ${typed.indemnityMonths || '–'}`
                )}
              </label>
            </th>
          </tr>
          {Array.from({ length: lines }, (_, i) => (
            <tr key={i}>
              {cells('pd', i)}
              {cells('te', i)}
            </tr>
          ))}
          {canEdit && (
            <tr>
              <td colSpan={2}>
                <Button variant="ghost" size="sm" iconLeft="plus" onClick={() => add('pd')}>
                  Add a property damage value
                </Button>
              </td>
              <td colSpan={2}>
                <Button variant="ghost" size="sm" iconLeft="plus" onClick={() => add('te')}>
                  Add a time element value
                </Button>
              </td>
            </tr>
          )}
          <tr>
            <th scope="row">Total Reported Site PD</th>
            <td>{formatAmount(totals.pd)}</td>
            <th scope="row">Total Reported Site TE</th>
            <td>{formatAmount(totals.te)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={3}>
              Total Insurable Values (TIV) / Total Sums Insured (TSI)
            </th>
            <td>{formatAmount(totals.tiv)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
