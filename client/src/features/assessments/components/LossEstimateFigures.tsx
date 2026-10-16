// Section 5 Loss Estimates in Review (GN-03), laid out as Marsh's template (pp. 12-17):
// the fixed opening, the Values table with currency, date and indemnity period,
// the Loss Estimate Definitions, then each level's tables. The assigned engineer
// types every figure here; the gateway computes the losses on save. Used by
// ReviewWorkspace above Section 5's drafted scenarios.
import { useState } from 'react'
import { Button, Callout } from '../../../design-system'
import { getLossEstimates, saveLossEstimates, type LossEstimates, type LossInputs } from '../api'
import { LOSS_LEVELS, LOSS_OPENING, toFigure, toText, VALUES_NOTE } from '../reportFigures'
import { useFigures } from '../useFigures'
import { LossLevelBlock, type TypedLevel } from './LossLevelBlock'
import { LossValuesTable, type TypedValue, type TypedValues } from './LossValuesTable'

// Every input as typed, so an empty box stays empty rather than becoming 0.
type Typed = TypedValues & { levels: Record<string, TypedLevel> }

function typedOf({ inputs }: LossEstimates): Typed {
  const row = (r: LossInputs['pd'][number]) => ({ ...r, value: toText(r.value) })
  return {
    currency: inputs.currency ?? '',
    dateOfValues: inputs.dateOfValues ?? '',
    indemnityMonths: toText(inputs.indemnityMonths),
    pd: inputs.pd.map(row),
    te: inputs.te.map(row),
    levels: Object.fromEntries(
      LOSS_LEVELS.map(({ level }) => {
        const saved = inputs.levels.find((l) => l.level === level)
        return [
          level,
          {
            damageRows: (
              saved?.damageRows ??
              inputs.pd.map((r) => ({
                ...r,
                percent: saved?.pd.find((p) => p.key === r.key)?.percent ?? null,
              }))
            ).map((r) => ({ ...r, value: toText(r.value), percent: toText(r.percent) })),
            te: Object.fromEntries(
              (saved?.te ?? []).map((r) => [
                r.key,
                { months: toText(r.months), percent: toText(r.percent) },
              ]),
            ),
          },
        ]
      }),
    ),
  }
}

// Damage rows belong to each level; time-element rows still follow the site values.
function inputsOf(t: Typed): LossInputs {
  const row = (r: TypedValue) => ({ key: r.key, item: r.item.trim(), value: toFigure(r.value) })
  return {
    currency: t.currency.trim().toUpperCase() || null,
    dateOfValues: t.dateOfValues || null,
    indemnityMonths: toFigure(t.indemnityMonths),
    pd: t.pd.map(row),
    te: t.te.map(row),
    levels: LOSS_LEVELS.map(({ level }) => ({
      level,
      pd: [],
      damageRows: t.levels[level].damageRows.map((r) => ({
        ...row(r),
        percent: toFigure(r.percent),
      })),
      te: t.te.map(({ key }) => {
        const entry = t.levels[level]?.te[key]
        return {
          key,
          months: toFigure(entry?.months ?? ''),
          percent: toFigure(entry?.percent ?? ''),
        }
      }),
    })),
  }
}

export function LossEstimateFigures({
  reference,
  canEdit,
  onSaved,
  drafted,
}: {
  reference: string
  canEdit: boolean
  onSaved?: () => void
  // Section 5's drafted findings by subsection heading ("Level I Scenario"), from
  // DraftEditor, placed in each level's definition table.
  drafted?: Map<string, React.ReactNode>
}) {
  const { figures, error, saving, save } = useFigures(
    reference,
    getLossEstimates,
    saveLossEstimates,
    onSaved,
  )
  // What the engineer has typed; reset to the saved figures whenever new ones arrive
  // (load or save), during render as React advises rather than in an effect.
  const [typed, setTyped] = useState<Typed | null>(null)
  const [loaded, setLoaded] = useState<LossEstimates | null>(null)
  if (figures && figures !== loaded) {
    setLoaded(figures)
    setTyped(typedOf(figures))
  }

  if (!figures || !typed)
    return error ? (
      <Callout tone="warning" title="Loss estimates not loaded">
        {error}
      </Callout>
    ) : null
  const { values, levels } = figures.result
  const set = (change: Partial<Typed>) => setTyped({ ...typed, ...change })

  return (
    <div className="rv-maturity">
      {LOSS_OPENING.map((p) => (
        <p key={p.slice(0, 20)} className="rv-muted">
          {p}
        </p>
      ))}
      <h3>Values</h3>
      <LossValuesTable typed={typed} totals={values} canEdit={canEdit} onChange={set} />
      <p className="rv-muted">{VALUES_NOTE}</p>
      <p className="rv-muted">
        Site values are the report’s overall insured values. Each loss level has its own property
        damage items below; changing site values does not change those items.
      </p>

      <div className="rv-maturity-scroll">
        <table className="rv-maturity-table" aria-label="Loss Estimate Definitions">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Definition</th>
            </tr>
          </thead>
          <tbody>
            {LOSS_LEVELS.map(({ level, definition, details }) => (
              <tr key={level}>
                <th scope="row">Level {level}</th>
                <td>
                  <strong>{definition}</strong>
                  <p>{details.intro}</p>
                  <ul>
                    {details.points.map((p) => (
                      <li key={p.slice(0, 30)}>{p}</li>
                    ))}
                  </ul>
                  {details.outro && <p>{details.outro}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {LOSS_LEVELS.map((meta) => (
        <LossLevelBlock
          key={meta.level}
          meta={meta}
          te={typed.te}
          typed={typed.levels[meta.level]}
          result={levels.find((l) => l.level === meta.level)}
          canEdit={canEdit}
          onChange={(level) => set({ levels: { ...typed.levels, [meta.level]: level } })}
          scenario={drafted?.get(`Level ${meta.level} Scenario`)}
          assumptions={drafted?.get(`Level ${meta.level} Assumptions`)}
        />
      ))}

      {error && (
        <div role="alert">
          <Callout tone="warning" title="Figures not saved">
            {error}
          </Callout>
        </div>
      )}
      {canEdit && (
        <div className="rv-figures-actions">
          <span className="rv-muted">Losses update when the figures are saved.</span>
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => save(inputsOf(typed))}
          >
            Save figures
          </Button>
        </div>
      )}
    </div>
  )
}
