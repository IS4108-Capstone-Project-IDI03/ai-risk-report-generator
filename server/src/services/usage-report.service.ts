// EV-04: turns the ai_calls rows (EV-03) into the usage and cost report.
// Called by routes/usage.routes.ts. Reads models/ai-call.model.ts and assessments.
import { AI_FEATURES, AiCallModel, type IAiCall } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import type { SessionUser } from './auth.service'

// A risk engineer asked for a report that is not assigned to them (EV-04 AC9).
export class ReportNotInScopeError extends Error {
  constructor() {
    super('That report is not assigned to you.')
    this.name = 'ReportNotInScopeError'
  }
}

export type UsageRow = {
  key: string
  calls: number
  estimatedCostUsd: number
  callsWithoutCost: number
  estimatedCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  searchUnits: number
  audioSeconds: number
  latency: {
    avgMs: number | null
    p50Ms: number | null
    p95Ms: number | null
    maxMs: number | null
  }
}

export type UsageSummary = {
  scope: { reportId: string | null }
  reports: string[]
  totals: Pick<UsageRow, 'calls' | 'estimatedCostUsd' | 'callsWithoutCost' | 'estimatedCalls'>
  byFeature: UsageRow[]
  byService: UsageRow[]
  pricingBases: { basis: string; calls: number; isEstimate: boolean }[]
}

// The price basis says "estimate" when the price is our own guess (Cohere).
const isEstimate = (basis: string) => /estimate/i.test(basis)
const round = (n: number) => Math.round(n * 1e6) / 1e6
const sum = (rows: IAiCall[], pick: (r: IAiCall) => number | null) =>
  rows.reduce((total, r) => total + (pick(r) ?? 0), 0)

// Nearest-rank percentile of an ascending list: the smallest value that at
// least p% of the values are at or below.
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  return sorted[Math.max(Math.ceil((p / 100) * sorted.length) - 1, 0)]
}

function toRow(key: string, rows: IAiCall[]): UsageRow {
  const durations = rows
    .map((r) => r.durationMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)
  return {
    key,
    calls: rows.length,
    estimatedCostUsd: round(sum(rows, (r) => r.estimatedCostUsd)),
    // A call with no cost is counted here, never added to the total as 0.
    callsWithoutCost: rows.filter((r) => r.estimatedCostUsd === null).length,
    estimatedCalls: rows.filter((r) => isEstimate(r.pricingBasis)).length,
    inputTokens: sum(rows, (r) => r.inputTokens),
    outputTokens: sum(rows, (r) => r.outputTokens),
    cacheReadTokens: sum(rows, (r) => r.cacheReadTokens),
    searchUnits: sum(rows, (r) => r.searchUnits),
    audioSeconds: sum(rows, (r) => r.audioSeconds),
    latency: {
      avgMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? durations[durations.length - 1] : null,
    },
  }
}

// Which reports this person may see: null means all (knowledge admin), else
// only reports where they are the assigned engineer (EV-04 AC9).
async function visibleReports(user: SessionUser): Promise<string[] | null> {
  if (user.role === 'knowledge_admin') return null
  const own = await AssessmentModel.find({ engineer: user.id }, { reference: 1 }).lean()
  return own.map((a) => a.reference)
}

/** Returns the usage and cost report for the report chosen, or everything the user may see. */
export async function summarizeUsage(user: SessionUser, reportId?: string): Promise<UsageSummary> {
  const visible = await visibleReports(user)
  if (reportId && visible && !visible.includes(reportId)) throw new ReportNotInScopeError()

  const filter = reportId ? { reportId } : visible ? { reportId: { $in: visible } } : {}
  // ponytail: summed in Node because the table is small; move to a Mongo
  // $group pipeline if it grows past tens of thousands of rows.
  const rows = await AiCallModel.find(filter).lean<IAiCall[]>()

  const reportFilter = visible ? { $in: visible } : { $ne: null }
  const reports = (await AiCallModel.distinct('reportId', { reportId: reportFilter }))
    .filter(Boolean)
    .sort()

  const services = [...new Set(rows.map((r) => r.billedService))]
  const byService = services
    .map((s) =>
      toRow(
        s,
        rows.filter((r) => r.billedService === s),
      ),
    )
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || a.key.localeCompare(b.key))

  const bases = new Map<string, number>()
  for (const r of rows) bases.set(r.pricingBasis, (bases.get(r.pricingBasis) ?? 0) + 1)

  const all = toRow('all', rows)
  return {
    scope: { reportId: reportId ?? null },
    reports,
    totals: {
      calls: all.calls,
      estimatedCostUsd: all.estimatedCostUsd,
      callsWithoutCost: all.callsWithoutCost,
      estimatedCalls: all.estimatedCalls,
    },
    byFeature: AI_FEATURES.map((f) =>
      toRow(
        f,
        rows.filter((r) => r.feature === f),
      ),
    ),
    byService,
    pricingBases: [...bases].map(([basis, calls]) => ({
      basis,
      calls,
      isEstimate: isEstimate(basis),
    })),
  }
}

const CSV_COLUMNS: [string, (r: UsageRow) => unknown][] = [
  ['calls', (r) => r.calls],
  ['estimated_cost_usd', (r) => r.estimatedCostUsd],
  ['calls_without_cost', (r) => r.callsWithoutCost],
  ['estimated_calls', (r) => r.estimatedCalls],
  ['input_tokens', (r) => r.inputTokens],
  ['output_tokens', (r) => r.outputTokens],
  ['cache_read_tokens', (r) => r.cacheReadTokens],
  ['search_units', (r) => r.searchUnits],
  ['audio_seconds', (r) => r.audioSeconds],
  ['avg_ms', (r) => r.latency.avgMs],
  ['p50_ms', (r) => r.latency.p50Ms],
  ['p95_ms', (r) => r.latency.p95Ms],
  ['max_ms', (r) => r.latency.maxMs],
]

// A value with a comma, quote or line break is wrapped in quotes so a
// spreadsheet reads it as one cell.
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Returns the breakdown on screen as CSV text: one row per feature or per billed service. */
export function usageCsv(summary: UsageSummary, groupBy: 'feature' | 'service'): string {
  const rows = groupBy === 'feature' ? summary.byFeature : summary.byService
  const head = [
    groupBy === 'feature' ? 'feature' : 'billed_service',
    ...CSV_COLUMNS.map(([name]) => name),
  ]
  const lines = rows.map((r) =>
    [r.key, ...CSV_COLUMNS.map(([, pick]) => pick(r))].map(csvCell).join(','),
  )
  return [head.join(','), ...lines].join('\n') + '\n'
}
