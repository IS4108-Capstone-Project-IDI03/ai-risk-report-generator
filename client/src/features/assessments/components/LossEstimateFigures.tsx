// Section 5 Loss Estimates in Review (GN-03), laid out as Marsh's template (pp. 12-17):
// the fixed opening, the Values table with currency, date and indemnity period,
// the Loss Estimate Definitions, then each level's tables. The assigned engineer
// types every figure here, or asks the model to propose each level's areas, % and
// months and confirms them (GN-03 addendum); the gateway computes the losses on save.
// Used by ReviewWorkspace above Section 5's drafted scenarios.
import { useState } from 'react'
import { Button, Callout } from '../../../design-system'
import {
  getLossEstimates,
  proposeLossEstimates,
  saveLossEstimates,
  type LossEstimates,
  type LossInputs,
  type ProposedWhy,
} from '../api'
import { LOSS_LEVELS, LOSS_OPENING, toFigure, toText, VALUES_NOTE } from '../reportFigures'
import { useFigures } from '../useFigures'
import { LossLevelBlock, type TypedLevel } from './LossLevelBlock'
import { LossValuesTable, type TypedValue, type TypedValues } from './LossValuesTable'
import { ProposalNote } from './ProposalNote'

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

// One proposed input's mark: what to call it in "Why these figures", and why.
type Marked = { label: string; why: ProposedWhy }

// What a proposal fills in (GN-03 addendum): each proposed level's damage areas and %
// (never a value: blank for the engineer) and each BI item's months and %, matched to
// the site's BI rows by name. Returns the filled form, and per level the inputs it
// filled, by row key and field (as LossLevelBlock marks them), so they can be marked
// and explained (AC13).
function withProposal(t: Typed, figures: LossEstimates) {
  const why: Record<string, Map<string, Marked>> = {}
  for (const p of figures.proposal?.levels ?? []) {
    const level = t.levels[p.level]
    const marks = (why[p.level] = new Map<string, Marked>())
    if (p.damage.length)
      level.damageRows = p.damage.map((d, i) => {
        const key = `pd-${p.level}-${i}`
        marks.set(`${key}:item`, { label: `${d.item} (area)`, why: d })
        if (d.percent !== null) marks.set(`${key}:percent`, { label: `${d.item} % damage`, why: d })
        return { key, item: d.item, value: '', percent: toText(d.percent) }
      })
    for (const e of p.te) {
      const row = t.te.find((r) => r.item === e.item)
      if (!row) continue
      level.te[row.key] = { months: toText(e.months), percent: toText(e.percent) }
      if (e.months !== null)
        marks.set(`${row.key}:months`, { label: `${e.item} outage months`, why: e })
      if (e.percent !== null)
        marks.set(`${row.key}:percent`, { label: `${e.item} % impacted`, why: e })
    }
  }
  return { typed: t, why }
}

// What is wrong with each typed figure, keyed as the boxes show it: "currency",
// "indemnity", "value:<row key>", and "<level>:<row key>:value|percent|months". The
// same rules the gateway checks on save (lossEstimatesSchema), shown as the engineer
// types so a refused save never has to name them.
function figureProblems(t: Typed): Map<string, string> {
  const problems = new Map<string, string>()
  const num = (text: string) => (text.trim() === '' ? null : Number(text))
  const negative = (text: string) => {
    const n = num(text)
    return n !== null && (Number.isNaN(n) || n < 0)
  }
  const notPercent = (text: string) => {
    const n = num(text)
    return n !== null && (Number.isNaN(n) || n < 0 || n > 100)
  }
  if (t.currency.trim() && !/^[A-Za-z]{3}$/.test(t.currency.trim()))
    problems.set('currency', 'Enter a 3-letter code')
  const indemnity = num(t.indemnityMonths)
  if (indemnity !== null && !(Number.isInteger(indemnity) && indemnity >= 1 && indemnity <= 120))
    problems.set('indemnity', 'Enter 1 to 120 months')
  for (const r of [...t.pd, ...t.te])
    if (negative(r.value)) problems.set(`value:${r.key}`, 'Enter 0 or more')
  for (const [level, typed] of Object.entries(t.levels)) {
    for (const r of typed.damageRows) {
      if (negative(r.value)) problems.set(`${level}:${r.key}:value`, 'Enter 0 or more')
      if (notPercent(r.percent)) problems.set(`${level}:${r.key}:percent`, 'Enter 0 to 100')
    }
    for (const [key, e] of Object.entries(typed.te)) {
      const months = num(e.months)
      if (negative(e.months)) problems.set(`${level}:${key}:months`, 'Enter 0 or more')
      // The policy pays no more than the indemnity period.
      else if (months !== null && indemnity !== null && months > indemnity)
        problems.set(`${level}:${key}:months`, 'More than the indemnity period')
      if (notPercent(e.percent)) problems.set(`${level}:${key}:percent`, 'Enter 0 to 100')
    }
  }
  return problems
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
  const { figures, error, saving, save, proposing, propose } = useFigures(
    reference,
    getLossEstimates,
    saveLossEstimates,
    onSaved,
    proposeLossEstimates,
  )
  // What the engineer has typed; reset to the saved figures whenever new ones arrive
  // (load or save), during render as React advises rather than in an effect.
  const [typed, setTyped] = useState<Typed | null>(null)
  const [loaded, setLoaded] = useState<LossEstimates | null>(null)
  // Per level, the inputs still holding the model's proposal, with why (AC13).
  const [why, setWhy] = useState<Record<string, Map<string, Marked>>>({})
  // Save was pressed while a figure is outlined in red; cleared by the next edit.
  const [blocked, setBlocked] = useState(false)
  if (figures && figures !== loaded) {
    setLoaded(figures)
    const filled = withProposal(typedOf(figures), figures)
    setTyped(filled.typed)
    setWhy(filled.why)
  }

  if (!figures || !typed)
    return error ? (
      <Callout tone="warning" title="Loss estimates not loaded">
        {error}
      </Callout>
    ) : null
  const { values, levels } = figures.result
  const set = (change: Partial<Typed>) => {
    setTyped({ ...typed, ...change })
    setBlocked(false)
  }
  const stillProposed = Object.values(why).some((m) => m.size > 0)
  const problems = figureProblems(typed)
  // Mirrors the gateway's levelFiguresEntered: proposing is offered only before then.
  const entered = figures.inputs.levels.some(
    (l) =>
      l.pd.some((r) => r.percent !== null) ||
      (l.damageRows ?? []).some((r) => r.percent !== null) ||
      l.te.some((r) => r.months !== null || r.percent !== null),
  )

  return (
    <div className="rv-maturity">
      {figures.proposal && stillProposed && (
        <ProposalNote
          proposal={figures.proposal}
          reasons={Object.entries(why).flatMap(([level, marks]) =>
            [...marks.values()].map(({ label, why: w }): [string, ProposedWhy] => [
              `Level ${level}, ${label}`,
              w,
            ]),
          )}
        />
      )}
      {LOSS_OPENING.map((p) => (
        <p key={p.slice(0, 20)} className="rv-muted">
          {p}
        </p>
      ))}
      <h3>Values</h3>
      <LossValuesTable
        typed={typed}
        totals={values}
        canEdit={canEdit}
        onChange={set}
        problem={(key) => problems.get(key)}
      />
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
          proposed={new Set(why[meta.level]?.keys())}
          problem={(key) => problems.get(`${meta.level}:${key}`)}
          onTouched={(key) => {
            const left = new Map(why[meta.level])
            left.delete(key)
            setWhy({ ...why, [meta.level]: left })
          }}
        />
      ))}

      {(error || blocked) && (
        <div role="alert">
          <Callout tone="warning" title="Figures not saved">
            {blocked ? 'Fix the figures outlined in red before saving.' : error}
          </Callout>
        </div>
      )}
      {canEdit && (
        <div className="rv-figures-actions">
          <span className="rv-muted">Losses update when the figures are saved.</span>
          {!entered && !figures.proposal && (
            <Button
              variant="secondary"
              size="sm"
              iconLeft="sparkles"
              loading={proposing}
              onClick={() => void propose()}
            >
              Propose figures
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => {
              // Nothing is sent while a figure is outlined: the gateway would refuse it.
              if (problems.size) return setBlocked(true)
              void save(inputsOf(typed))
            }}
          >
            {/* Saving proposed figures is the engineer confirming them (AC14). */}
            {stillProposed ? 'Confirm figures' : 'Save figures'}
          </Button>
        </div>
      )}
    </div>
  )
}
