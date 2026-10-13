// EV-04: turns the ai_calls rows (EV-03) into the usage and cost report.
// Called by routes/usage.routes.ts. Reads models/ai-call.model.ts, assessments
// (for the assigned engineer, client and site) and users (for names).
import { Types } from 'mongoose'
import { AI_FEATURES, AiCallModel, type IAiCall } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { UserModel } from '../models/user.model'
import type { SessionUser } from './auth.service'
import { clientNameOf } from './client.service'

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

// ── Overview: report generation across assessments and engineers ──────────

export const OVERVIEW_GROUPS = ['assessment', 'engineer'] as const
export const OVERVIEW_SPLITS = ['service', 'feature'] as const
export const OVERVIEW_RANGES = ['7d', '30d', 'month', 'all'] as const
export type OverviewQuery = {
  groupBy: (typeof OVERVIEW_GROUPS)[number]
  split: (typeof OVERVIEW_SPLITS)[number]
  range: (typeof OVERVIEW_RANGES)[number]
  // Only the calls attributed to this engineer (their bar was chosen).
  engineer?: string
}

// Document ingestion has its own tab; the overview is report generation.
export const INGESTION_FEATURES: readonly IAiCall['feature'][] = [
  'label-document',
  'ocr',
  'embed-document',
]
// The group chat falls under when grouping by assessment: it has none.
export const CHAT_GROUP = 'chat'
// The group for an assessment with no engineer assigned.
export const UNASSIGNED_GROUP = 'unassigned'

const DAY_MS = 86_400_000
// Singapore is UTC+8 all year (no daylight saving), so "this month" starts at
// 00:00 on the 1st there, 16:00 UTC the day before.
const SINGAPORE_OFFSET_MS = 8 * 3_600_000

/** The first moment a period covers, or null for all time. */
export function rangeStart(range: OverviewQuery['range'], now = new Date()): Date | null {
  switch (range) {
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS)
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS)
    case 'month': {
      const there = new Date(now.getTime() + SINGAPORE_OFFSET_MS)
      const first = Date.UTC(there.getUTCFullYear(), there.getUTCMonth(), 1)
      return new Date(first - SINGAPORE_OFFSET_MS)
    }
    case 'all':
      return null
  }
}

export type OverviewGroup = {
  key: string
  label: string
  reference: string | null
  client: string | null
  siteName: string | null
  engineerId: string | null
  engineerName: string | null
  lastActivityAt: string
  calls: number
  estimatedCostUsd: number
  callsWithoutCost: number
  // Cost per split key (billed service or feature); the bar's stacked parts.
  segments: Record<string, number>
}

export type UsageOverview = {
  scope: OverviewQuery & { from: string | null }
  totals: Pick<UsageRow, 'calls' | 'estimatedCostUsd' | 'callsWithoutCost' | 'estimatedCalls'>
  // Every split key present, costliest first, so each keeps one colour and order.
  splitKeys: string[]
  groups: OverviewGroup[]
  pricingBases: UsageSummary['pricingBases']
}

// What one assessment contributes to a row's group: the populated lookup.
type AssessmentInfo = {
  reference: string
  client?: string
  site?: { name?: string; client?: { name?: string } } | null
  engineer?: { _id: Types.ObjectId; name: string } | null
}

// The provider calls a set of rows stands for: a row is more than 1 only for ingestion.
const callsIn = (rows: IAiCall[]) => rows.reduce((n, r) => n + (r.callCount ?? 1), 0)

/**
 * Returns report-generation cost across assessments or engineers, for the
 * period chosen. A knowledge admin sees everything; a risk engineer only their
 * assigned assessments and their own chat. Report calls belong to the
 * assessment's assigned engineer; chat calls to the user who asked.
 */
export async function usageOverview(
  user: SessionUser,
  query: OverviewQuery,
): Promise<UsageOverview> {
  const from = rangeStart(query.range)
  const visible = await visibleReports(user)
  const scope = visible
    ? {
        $or: [
          { reportId: { $in: visible } },
          { feature: 'chat' as const, userId: new Types.ObjectId(user.id) },
        ],
      }
    : {}
  const rows = await AiCallModel.find({
    ...scope,
    feature: { $nin: [...INGESTION_FEATURES] },
    ...(from && { createdAt: { $gte: from } }),
  }).lean<IAiCall[]>()

  const references = [...new Set(rows.map((r) => r.reportId).filter((r): r is string => !!r))]
  const assessments = new Map(
    (
      await AssessmentModel.find(
        { reference: { $in: references } },
        'reference client site engineer',
      )
        .populate({
          path: 'site',
          select: 'name client',
          populate: { path: 'client', select: 'name' },
        })
        .populate('engineer', 'name')
        .lean<AssessmentInfo[]>()
    ).map((a) => [a.reference, a]),
  )
  const askers = [...new Set(rows.flatMap((r) => (r.userId ? [String(r.userId)] : [])))]
  // Names by user id: assigned engineers (populated above) and chat askers.
  const names = new Map(
    (await UserModel.find({ _id: { $in: askers } }, 'name').lean()).map((u) => [
      String(u._id),
      u.name,
    ]),
  )
  for (const a of assessments.values())
    if (a.engineer) names.set(String(a.engineer._id), a.engineer.name)

  // Whose a call is: the assessment's assigned engineer, or the chat's asker.
  const engineerOf = (r: IAiCall) => {
    if (r.feature === 'chat' && r.userId) return String(r.userId)
    const engineer = r.reportId ? assessments.get(r.reportId)?.engineer : null
    return engineer ? String(engineer._id) : null
  }
  const kept = query.engineer ? rows.filter((r) => engineerOf(r) === query.engineer) : rows
  const groupKey = (r: IAiCall) => {
    if (query.groupBy === 'engineer') return engineerOf(r) ?? UNASSIGNED_GROUP
    // Outside ingestion, only chat has no report.
    return r.reportId ?? CHAT_GROUP
  }
  const splitKey = (r: IAiCall) => (query.split === 'service' ? r.billedService : r.feature)

  const byGroup = new Map<string, IAiCall[]>()
  for (const r of kept) {
    const key = groupKey(r)
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(r)
  }
  const uncosted = (rows: IAiCall[]) => callsIn(rows.filter((r) => r.estimatedCostUsd === null))

  const groups = [...byGroup].map(([key, members]): OverviewGroup => {
    const segments: Record<string, number> = {}
    for (const r of members)
      if (r.estimatedCostUsd !== null)
        segments[splitKey(r)] = round((segments[splitKey(r)] ?? 0) + r.estimatedCostUsd)
    const shared = {
      key,
      lastActivityAt: new Date(
        Math.max(...members.map((r) => +new Date(r.createdAt))),
      ).toISOString(),
      calls: callsIn(members),
      estimatedCostUsd: round(sum(members, (r) => r.estimatedCostUsd)),
      callsWithoutCost: uncosted(members),
      segments,
    }
    const none = { reference: null, client: null, siteName: null }
    if (query.groupBy === 'engineer') {
      const unassigned = key === UNASSIGNED_GROUP
      const name = unassigned ? null : (names.get(key) ?? null)
      return {
        ...shared,
        ...none,
        label: unassigned ? 'Unassigned' : (name ?? 'Unknown user'),
        engineerId: unassigned ? null : key,
        engineerName: name,
      }
    }
    if (key === CHAT_GROUP)
      return { ...shared, ...none, label: 'Chatbot', engineerId: null, engineerName: null }
    const a = assessments.get(key)
    return {
      ...shared,
      label: key,
      reference: key,
      client: a ? clientNameOf(a.site, a.client) || null : null,
      siteName: a?.site?.name ?? null,
      engineerId: a?.engineer ? String(a.engineer._id) : null,
      engineerName: a?.engineer?.name ?? null,
    }
  })
  groups.sort((x, y) => y.estimatedCostUsd - x.estimatedCostUsd || x.key.localeCompare(y.key))

  const splitTotals = new Map<string, number>()
  for (const r of kept)
    splitTotals.set(splitKey(r), (splitTotals.get(splitKey(r)) ?? 0) + (r.estimatedCostUsd ?? 0))
  const splitKeys = [...splitTotals]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([k]) => k)

  const bases = new Map<string, number>()
  for (const r of kept) bases.set(r.pricingBasis, (bases.get(r.pricingBasis) ?? 0) + callsIn([r]))
  return {
    scope: { ...query, from: from?.toISOString() ?? null },
    totals: {
      calls: callsIn(kept),
      estimatedCostUsd: round(sum(kept, (r) => r.estimatedCostUsd)),
      callsWithoutCost: uncosted(kept),
      estimatedCalls: callsIn(kept.filter((r) => isEstimate(r.pricingBasis))),
    },
    splitKeys,
    groups,
    pricingBases: [...bases].map(([basis, calls]) => ({
      basis,
      calls,
      isEstimate: isEstimate(basis),
    })),
  }
}
