// Gateway calls for the Usage and costs screen (EV-04).
// Called by screens/ in this folder. The CSV exports are plain links.
import { request } from '../accounts/api'
import type { CostGroup } from './chart'

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

export type Totals = {
  calls: number
  estimatedCostUsd: number
  callsWithoutCost: number
  estimatedCalls: number
}
export type PricingBasis = { basis: string; calls: number; isEstimate: boolean }

// One feature's cost split by the service that billed it.
export type FeatureServiceRow = {
  feature: string
  calls: number
  estimatedCostUsd: number
  segments: Record<string, number>
}

// What drafting one report section cost. `section` is null for drafting saved
// before sections were recorded.
export type SectionRow = {
  section: string | null
  title: string
  calls: number
  drafts: number
  estimatedCostUsd: number
  callsWithoutCost: number
}

export type UsageSummary = {
  scope: { reportId: string | null }
  reports: string[]
  totals: Totals
  byFeature: UsageRow[]
  byService: UsageRow[]
  byFeatureService: FeatureServiceRow[]
  bySection: SectionRow[]
  pricingBases: PricingBasis[]
}

export type UsageView = 'feature' | 'service'
export type GroupBy = 'assessment' | 'engineer'
export type Range = '7d' | '30d' | 'month' | 'all'

export type OverviewQuery = {
  groupBy: GroupBy
  split: UsageView
  range: Range
  // Only this engineer's calls (their bar or row was chosen).
  engineer?: string
}

// One line of a row's cost calculation: quantity × usdPer / per = costUsd, at
// the rates stored with each call when it was made. 'not priced' gathers calls
// with no cost; 'rates not recorded' calls saved before rates were kept, at
// their stored cost. Their notes say why.
export type CostLine = {
  service: string
  model: string
  part:
    'input' | 'output' | 'cached input' | 'searches' | 'audio' | 'not priced' | 'rates not recorded'
  unit: 'tokens' | 'searches' | 'minutes'
  quantity: number
  usdPer: number
  per: number
  costUsd: number
  note: string | null
}

// What every overview group and document carries for checking its cost by
// hand. Its lines add up to the row's total cost.
export type CostCheck = {
  // Tokens used, summed from what providers reported; never cost ÷ rate.
  totalTokens: number
  costLines: CostLine[]
}

// One assessment, engineer, or the Chatbot (key `chat`) in the overview.
export type OverviewGroup = CostGroup &
  CostCheck & {
    reference: string | null
    client: string | null
    siteName: string | null
    engineerId: string | null
    engineerName: string | null
    calls: number
    callsWithoutCost: number
  }

export type UsageOverview = {
  scope: OverviewQuery & { from: string | null }
  totals: Totals
  splitKeys: string[]
  groups: OverviewGroup[]
  pricingBases: PricingBasis[]
}

// The ingestion tab's query: knowledge admins only.
export type IngestionQuery = { split: UsageView; range: Range }

// What reading one knowledge document cost. `saved` is false for an upload
// refused after labelling, or labelling from before calls named a document.
export type DocumentUsage = CostGroup &
  CostCheck & {
    title: string
    fileName: string | null
    status: string | null
    saved: boolean
    uploadedAt: string | null
    pages: number | null
    calls: number
    callsWithoutCost: number
    usdPerPage: number | null
    avgMsPerCall: number | null
  }

export type IngestionUsage = {
  scope: IngestionQuery & { from: string | null }
  totals: Totals
  splitKeys: string[]
  documents: DocumentUsage[]
  pricingBases: PricingBasis[]
}

// `request` also ends the session on a 401.
export function getUsageSummary(reportId: string, signal?: AbortSignal): Promise<UsageSummary> {
  const query = reportId ? `?reportId=${encodeURIComponent(reportId)}` : ''
  return request<UsageSummary>(`/api/usage/summary${query}`, { signal })
}

const overviewParams = (q: OverviewQuery) => {
  const params = new URLSearchParams({ groupBy: q.groupBy, split: q.split, range: q.range })
  if (q.engineer) params.set('engineer', q.engineer)
  return params
}

export function getUsageOverview(q: OverviewQuery, signal?: AbortSignal): Promise<UsageOverview> {
  return request<UsageOverview>(`/api/usage/overview?${overviewParams(q)}`, { signal })
}

// The CSV links. Plain links (not fetch) so the browser sends the session cookie.
export function exportUrl(reportId: string, view: UsageView): string {
  const params = new URLSearchParams({ groupBy: view })
  if (reportId) params.set('reportId', reportId)
  return `/api/usage/export.csv?${params}`
}

const ingestionParams = (q: IngestionQuery) =>
  new URLSearchParams({ split: q.split, range: q.range })

export function getIngestionUsage(
  q: IngestionQuery,
  signal?: AbortSignal,
): Promise<IngestionUsage> {
  return request<IngestionUsage>(`/api/usage/ingestion?${ingestionParams(q)}`, { signal })
}

export function ingestionExportUrl(q: IngestionQuery): string {
  return `/api/usage/ingestion/export.csv?${ingestionParams(q)}`
}

export function overviewExportUrl(q: OverviewQuery): string {
  return `/api/usage/overview/export.csv?${overviewParams(q)}`
}
