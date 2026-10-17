// One level's page of Section 5 (GN-03, template pp. 15-17): its title and
// definition, then the Property Damage and Business Interruption tables. The
// engineer types each value's % damage and each time element's outage months and
// % impacted; the losses are the gateway's, as last saved (AC7). Used by
// LossEstimateFigures.tsx.
import { Button, IconButton, Input } from '../../../design-system'
import type { LossEstimates } from '../api'
import { formatAmount, type LOSS_LEVELS } from '../reportFigures'
import type { TypedValue } from './LossValuesTable'

// The engineer's entries for one level, as typed: % by PD row key, and months
// and % by TE row key.
export type TypedLevel = {
  damageRows: (TypedValue & { percent: string })[]
  te: Record<string, { months: string; percent: string }>
}

const amount = (text: string) => formatAmount(text === '' ? null : Number(text))

export function LossLevelBlock({
  meta,
  te,
  typed,
  result,
  canEdit,
  onChange,
  scenario,
  assumptions,
}: {
  meta: (typeof LOSS_LEVELS)[number]
  te: TypedValue[]
  typed: TypedLevel
  result: LossEstimates['result']['levels'][number] | undefined
  canEdit: boolean
  onChange: (typed: TypedLevel) => void
  // The drafted Scenario and Assumptions findings (Review), if drafted.
  scenario?: React.ReactNode
  assumptions?: React.ReactNode
}) {
  const title = `Property – Level ${meta.level} Loss Estimate`
  // A row's loss as last saved, or "Not entered" (AC1).
  const lossOf = (rows: { key: string; loss: number | null }[] | undefined, key: string) =>
    formatAmount(rows?.find((r) => r.key === key)?.loss ?? null)
  const field = (label: string, value: string, set: (v: string) => void, max?: number) =>
    canEdit ? (
      <Input
        size="sm"
        type="number"
        min={0}
        max={max}
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    ) : (
      value || '–'
    )

  const setDamageRow = (key: string, change: Partial<TypedLevel['damageRows'][number]>) =>
    onChange({
      ...typed,
      damageRows: typed.damageRows.map((r) => (r.key === key ? { ...r, ...change } : r)),
    })

  return (
    <section aria-label={title} className="rv-figures-level">
      <h3>{title}</h3>
      <p className="rv-figures-level-name">{meta.name}</p>
      {/* The template's definition table (p. 15): the drafted text in its rows.
          Limitations is in the template but blank in every sample report, so it
          is not drafted (Miya, 14 Oct). */}
      <div className="rv-maturity-scroll">
        <table
          className="rv-maturity-table rv-figures-table"
          aria-label={`Level ${meta.level} ${meta.name}`}
        >
          <thead>
            <tr>
              <th scope="col">Definition</th>
              <th scope="col">Definition: {meta.definition}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Scenario</th>
              <td>{scenario ?? <span className="rv-muted">Not drafted yet</span>}</td>
            </tr>
            <tr>
              <th scope="row">Assumptions</th>
              <td>{assumptions ?? <span className="rv-muted">Not drafted yet</span>}</td>
            </tr>
            <tr>
              <th scope="row">Limitations</th>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="rv-maturity-scroll">
        <table
          className="rv-maturity-table rv-figures-table rv-damage-table"
          aria-label={`Level ${meta.level} Property Damage`}
        >
          <thead>
            <tr>
              <th scope="col">Property Damage</th>
              <th scope="col">Value</th>
              <th scope="col">% Damage</th>
              <th scope="col">Property Damage</th>
            </tr>
          </thead>
          <tbody>
            {typed.damageRows.map((row, i) => (
              <tr key={row.key}>
                <td>
                  {canEdit ? (
                    <div className="rv-figures-item">
                      <Input
                        size="sm"
                        maxLength={100}
                        aria-label={`Level ${meta.level} damage item ${i + 1}`}
                        value={row.item}
                        onChange={(e) => setDamageRow(row.key, { item: e.target.value })}
                      />
                      <IconButton
                        icon="trash-2"
                        size="sm"
                        label={`Remove damage item ${i + 1} from Level ${meta.level}`}
                        onClick={() =>
                          onChange({
                            ...typed,
                            damageRows: typed.damageRows.filter((r) => r.key !== row.key),
                          })
                        }
                      />
                    </div>
                  ) : (
                    row.item
                  )}
                </td>
                <td>
                  {field(`Level ${meta.level} damage value ${i + 1}`, row.value, (value) =>
                    setDamageRow(row.key, { value }),
                  )}
                </td>
                <td>
                  {field(
                    `${row.item} % damage`,
                    row.percent,
                    (percent) => setDamageRow(row.key, { percent }),
                    100,
                  )}
                </td>
                <td>{lossOf(result?.pd, row.key)}</td>
              </tr>
            ))}
            {canEdit && (
              <tr>
                <td colSpan={4}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft="plus"
                    disabled={typed.damageRows.length >= 30}
                    onClick={() =>
                      onChange({
                        ...typed,
                        damageRows: [
                          ...typed.damageRows,
                          {
                            key: `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                            item: '',
                            value: '',
                            percent: '',
                          },
                        ],
                      })
                    }
                  >
                    Add a damage item to Level {meta.level}
                  </Button>
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                Total Property Damage Loss
              </th>
              <td>{formatAmount(result?.pdLoss ?? null)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="rv-maturity-scroll">
        <table
          className="rv-maturity-table rv-figures-table"
          aria-label={`Level ${meta.level} Business Interruption`}
        >
          <thead>
            <tr>
              <th scope="col">Business Interruption</th>
              <th scope="col">Value</th>
              <th scope="col">Duration (months)</th>
              <th scope="col">% Impacted</th>
              <th scope="col">BI Loss</th>
            </tr>
          </thead>
          <tbody>
            {te.map((row) => {
              const entry = typed.te[row.key] ?? { months: '', percent: '' }
              const set = (change: Partial<typeof entry>) =>
                onChange({ ...typed, te: { ...typed.te, [row.key]: { ...entry, ...change } } })
              return (
                <tr key={row.key}>
                  <td>{row.item}</td>
                  <td>{amount(row.value)}</td>
                  <td>
                    {field(`${row.item} outage months`, entry.months, (months) => set({ months }))}
                  </td>
                  <td>
                    {field(
                      `${row.item} % impacted`,
                      entry.percent,
                      (percent) => set({ percent }),
                      100,
                    )}
                  </td>
                  <td>{lossOf(result?.te, row.key)}</td>
                </tr>
              )
            })}
            <tr>
              <th scope="row" colSpan={4}>
                Total Business Interruption Loss
              </th>
              <td>{formatAmount(result?.teLoss ?? null)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={4}>
                Total Level {meta.level} Property Loss Estimate
              </th>
              <td>{formatAmount(result?.total ?? null)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* The rules behind each figure (AC7). */}
      <p className="rv-muted">
        Property damage = value × % damage. BI loss = value × outage months ÷ indemnity period × %
        impacted.
      </p>
    </section>
  )
}
