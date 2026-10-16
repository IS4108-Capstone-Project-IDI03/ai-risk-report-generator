// Section 5 Loss Estimates (GN-03): the site values the engineer enters, each
// level's % damage and outage months, and the losses computed from them by fixed
// rules, so no figure comes from the language model (AC10). Called by
// routes/assessment.routes.ts and section.service.ts.
import { Types } from 'mongoose'
import { z } from 'zod'
import { AssessmentModel, type IAssessment } from '../models/assessment.model'
import type { SessionUser } from './auth.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { assessmentToDraft } from './section.service'

// Levels I-III, as in every sample report (Level IV is left out; Miya, 14 Oct).
export const LOSS_LEVELS = ['I', 'II', 'III'] as const
const RULES_VERSION = 'le-v1'

const amount = z.number().min(0).max(1e13).nullable()
const percent = z.number().min(0).max(100).nullable()
const row = z.object({
  key: z.string().min(1).max(40),
  item: z.string().trim().max(100),
  value: amount,
})

// The whole Section 5 input, saved at once. Each level row names a value row by
// its key. Outage months may not exceed the indemnity period: the policy pays no
// more than that (AC6).
export const lossEstimatesSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    dateOfValues: z.iso.date().nullable(),
    indemnityMonths: z.number().int().min(1).max(120).nullable(),
    pd: z.array(row).max(30),
    te: z.array(row).max(30),
    levels: z
      .array(
        z.object({
          level: z.enum(LOSS_LEVELS),
          pd: z.array(z.object({ key: z.string(), percent })).max(30),
          // Absent on older estimates: retain their site-value rows unchanged.
          damageRows: z
            .array(
              row.extend({
                item: z.string().trim().min(1, 'Enter a name for each damage item.').max(100),
                percent,
              }),
            )
            .max(30)
            .optional(),
          te: z
            .array(z.object({ key: z.string(), months: z.number().min(0).nullable(), percent }))
            .max(30),
        }),
      )
      .max(3),
  })
  .superRefine((input, ctx) => {
    const keys = [...input.pd, ...input.te].map((r) => r.key)
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Each value row needs its own key.' })
    if (new Set(input.levels.map((l) => l.level)).size !== input.levels.length)
      ctx.addIssue({ code: 'custom', message: 'Each level appears once.' })
    for (const level of input.levels) {
      if (
        level.damageRows &&
        new Set(level.damageRows.map((r) => r.key)).size !== level.damageRows.length
      )
        ctx.addIssue({
          code: 'custom',
          message: `Level ${level.level}: each damage row needs its own key.`,
        })
      const named = [...level.pd, ...level.te].map((r) => r.key)
      if (named.some((k) => !keys.includes(k)))
        ctx.addIssue({
          code: 'custom',
          message: `Level ${level.level} names an unknown value row.`,
        })
      if (level.te.some((r) => r.months !== null && r.months > (input.indemnityMonths ?? Infinity)))
        ctx.addIssue({
          code: 'custom',
          message: `Level ${level.level}: outage months exceed the indemnity period.`,
        })
    }
  })

export type LossInputs = z.infer<typeof lossEstimatesSchema>

// To the cent, so 28.4% of a value is not 567999.9999.
const cents = (n: number) => Math.round(n * 100) / 100
// A sum of figures, or null if any is missing (AC1): never a partial total.
const total = (figures: (number | null)[]) =>
  figures.some((f) => f === null) ? null : cents(figures.reduce<number>((s, f) => s + f!, 0))

// The values' totals, and each level row by row (AC7) with its PD, BI and total.
// Rules (le-v1, read from Marsh's sample reports):
//   PD loss = value x % damage;
//   BI loss = TE value x outage months / indemnity months x % impacted.
// A row missing an input has no loss, and its level's totals none either.
export function estimate(input: LossInputs) {
  const levels = LOSS_LEVELS.map((level) => {
    const given = input.levels.find((l) => l.level === level)
    const pd =
      given?.damageRows === undefined
        ? input.pd.map((v) => {
            const pct = given?.pd.find((r) => r.key === v.key)?.percent ?? null
            const loss = v.value === null || pct === null ? null : cents((v.value * pct) / 100)
            return { key: v.key, item: v.item, value: v.value, percent: pct, loss }
          })
        : given.damageRows.map((r) => ({
            ...r,
            loss:
              r.value === null || r.percent === null ? null : cents((r.value * r.percent) / 100),
          }))
    const te = input.te.map((v) => {
      const r = given?.te.find((t) => t.key === v.key)
      const months = r?.months ?? null
      const pct = r?.percent ?? null
      const loss =
        v.value === null || months === null || pct === null || input.indemnityMonths === null
          ? null
          : cents((v.value * months * pct) / (input.indemnityMonths * 100))
      return { key: v.key, item: v.item, value: v.value, months, percent: pct, loss }
    })
    const pdLoss = pd.length ? total(pd.map((r) => r.loss)) : null
    const teLoss = total(te.map((r) => r.loss))
    return { level, pd, te, pdLoss, teLoss, total: total([pdLoss, teLoss]) }
  })
  const pdValues = total(input.pd.map((v) => v.value))
  const teValues = total(input.te.map((v) => v.value))
  return {
    values: { pd: pdValues, te: teValues, tiv: total([pdValues, teValues]) },
    levels,
    rulesVersion: RULES_VERSION,
  }
}

// Before anything is entered: the template's value rows (p. 12), all empty, and
// no level figures. The engineer renames, adds or removes rows to suit the site.
const row0 = (key: string, item: string) => ({ key, item, value: null })
const BLANK: LossInputs = {
  currency: null,
  dateOfValues: null,
  indemnityMonths: null,
  pd: [
    row0('pd-buildings', 'Buildings'),
    row0('pd-contents', 'Contents'),
    row0('pd-plant', 'Plant & Equipment'),
    row0('pd-stock', 'Stock'),
    row0('pd-other', 'Other'),
  ],
  te: [
    row0('te-bi', 'Business Interruption'),
    row0('te-rents', 'Loss of Rents'),
    row0('te-extra', 'Extra Expense'),
    row0('te-other', 'Other'),
  ],
  levels: [],
}

function lossEstimatesOf(saved: IAssessment['lossEstimates']) {
  // Saved only after lossEstimatesSchema passed, so the shape holds.
  const inputs = (saved?.inputs as LossInputs | undefined) ?? BLANK
  return { inputs, result: estimate(inputs), updatedAt: saved?.updatedAt ?? null }
}

export async function getLossEstimates(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'lossEstimates').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return lossEstimatesOf(assessment.lossEstimates)
}

// Saves the whole input. Only the assigned engineer can, while not archived.
export async function saveLossEstimates(reference: string, input: LossInputs, user: SessionUser) {
  const assessment = await assessmentToDraft(reference, user)
  const lossEstimates = {
    inputs: input,
    updatedAt: new Date(),
    updatedBy: new Types.ObjectId(user.id),
  }
  await AssessmentModel.updateOne({ _id: assessment._id }, { $set: { lossEstimates } })
  return lossEstimatesOf(lossEstimates)
}

// What drafting Section 5's scenarios is given (AC9): the values and each
// level's figures, one level per line, for the model to use unchanged; or why
// it cannot be drafted yet (AC1). Figures are written plain (1000000), as
// rag-service's check_numbers_grounded reads them.
export function lossEstimateFacts(saved: IAssessment['lossEstimates']) {
  const { inputs, result } = lossEstimatesOf(saved)
  const complete =
    inputs.currency &&
    inputs.dateOfValues &&
    inputs.indemnityMonths &&
    result.values.tiv !== null &&
    result.levels.every((l) => l.total !== null)
  if (!complete)
    return {
      missing:
        'Enter the values, currency, date, indemnity period and every level’s % and months first.',
    }
  return {
    facts: [
      `Values in ${inputs.currency} as at ${inputs.dateOfValues}; indemnity period ${inputs.indemnityMonths} months.`,
      ...[...inputs.pd, ...inputs.te].map((v) => `${v.item}: ${v.value}`),
      ...result.levels.map(
        (l) =>
          `Level ${l.level}: ` +
          [
            ...l.pd.map(
              (r) =>
                `${r.item} ${r.percent}% damage, loss ${r.loss}` +
                (inputs.levels.find((entry) => entry.level === l.level)?.damageRows !== undefined
                  ? `; value ${r.value}`
                  : ''),
            ),
            ...l.te.map(
              (r) => `${r.item} ${r.months} months at ${r.percent}% impacted, loss ${r.loss}`,
            ),
          ].join('; ') +
          `; total ${l.total}.`,
      ),
    ].join('\n'),
  }
}
