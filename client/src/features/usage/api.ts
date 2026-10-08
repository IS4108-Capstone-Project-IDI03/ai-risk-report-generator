// Gateway calls for the Usage and costs screen (EV-04).
// Called by screens/UsageCosts.tsx. Calls GET /api/usage/summary; the CSV is a plain link.
import { request } from '../accounts/api'

// Matches the summary shape in server/src/services/usage-report.service.ts.
export type Latency = {
  avgMs: number | null
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
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
  latency: Latency
}

export type UsageSummary = {
  scope: { reportId: string | null }
  reports: string[]
  totals: {
    calls: number
    estimatedCostUsd: number
    callsWithoutCost: number
    estimatedCalls: number
  }
  byFeature: UsageRow[]
  byService: UsageRow[]
  pricingBases: { basis: string; calls: number; isEstimate: boolean }[]
}

export type UsageView = 'feature' | 'service'

// `request` also ends the session on a 401.
export function getUsageSummary(reportId: string, signal?: AbortSignal): Promise<UsageSummary> {
  const query = reportId ? `?reportId=${encodeURIComponent(reportId)}` : ''
  return request<UsageSummary>(`/api/usage/summary${query}`, { signal })
}

// The CSV link. A plain link (not fetch) so the browser sends the session cookie.
export function exportUrl(reportId: string, view: UsageView): string {
  const params = new URLSearchParams({ groupBy: view })
  if (reportId) params.set('reportId', reportId)
  return `/api/usage/export.csv?${params}`
}
