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
  // Only for one chosen report; empty otherwise.
  rateRows: RateRow[]
}

export type RatePart = 'input' | 'output' | 'cached input' | 'searches' | 'audio'
// One quantity with the rate its calls were charged at when made:
// quantity × usdPer / per = costUsd. Rate and cost are null when not known.
export type RateCell = {
  quantity: number
  unit: 'tokens' | 'searches' | 'minutes'
  usdPer: number | null
  per: number
  costUsd: number | null
  // Why a rate is $0 (trial key, self-hosted).
  note: string | null
}
// A feature's calls to one model at one set of rates. 'not recorded': saved
// before rates were kept, at its stored cost; 'not priced': no cost. `note` says why.
export type RateRow = {
  feature: string
  service: string
  model: string
  calls: number
  rates: 'charged' | 'not recorded' | 'not priced'
  note: string | null
  cells: Partial<Record<RatePart, RateCell>>
  costUsd: number | null
  avgMsPerCall: number | null
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

// One assessment, engineer, or the Chatbot (key `chat`) in the overview.
export type OverviewGroup = CostGroup & {
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
export type DocumentUsage = CostGroup & {
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

// One document's ingestion cost, all time (its detail page).
export type DocumentUsageDetail = {
  key: string
  title: string
  fileName: string | null
  status: string | null
  saved: boolean
  uploadedAt: string | null
  pages: number | null
  totals: Totals
  // Cost per stage (labelling, OCR, embedding), split by the service that billed it.
  byFeatureService: FeatureServiceRow[]
  rateRows: RateRow[]
}

// A chat day (key YYYY-MM-DD) or month (YYYY-MM), Singapore time, or a person
// who asked (key: user id).
export type ChatGroup = {
  key: string
  calls: number
  estimatedCostUsd: number
  callsWithoutCost: number
  // Null for a day or month with no chat.
  lastActivityAt: string | null
  segments: Record<string, number>
}

// A calendar month (at: YYYY-MM) or year (at: YYYY), Singapore time.
export type ChatPeriod = { period: 'month' | 'year'; at: string }

// The chatbot's cost for a month or year: a bucket per day or month up to
// today, oldest first, and each person who asked, costliest first. A risk
// engineer gets only their own chat. `complete`: the period has ended.
export type ChatUsage = {
  scope: ChatPeriod & { complete: boolean }
  totals: Totals
  splitKeys: string[]
  buckets: ChatGroup[]
  byUser: (ChatGroup & { name: string })[]
  rateRows: RateRow[]
  // The period before, to compare against.
  previous: { at: string; calls: number; estimatedCostUsd: number }
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

export function getDocumentUsage(key: string, signal?: AbortSignal): Promise<DocumentUsageDetail> {
  return request<DocumentUsageDetail>(`/api/usage/ingestion/${encodeURIComponent(key)}`, {
    signal,
  })
}

// One assessment's usage at the rates charged, one line per billed part.
export function ratesExportUrl(reportId: string): string {
  return `/api/usage/export.csv?${new URLSearchParams({ groupBy: 'rates', reportId })}`
}

// One document's usage at the rates charged, one line per billed part.
export function documentExportUrl(key: string): string {
  return `/api/usage/ingestion/${encodeURIComponent(key)}/export.csv`
}

export function getChatUsage(chosen: ChatPeriod, signal?: AbortSignal): Promise<ChatUsage> {
  return request<ChatUsage>(`/api/usage/chat?${new URLSearchParams(chosen)}`, { signal })
}

// The chat's usage at the rates charged, for the period, one line per billed part.
export function chatExportUrl(chosen: ChatPeriod): string {
  return `/api/usage/chat/export.csv?${new URLSearchParams(chosen)}`
}

export function ingestionExportUrl(q: IngestionQuery): string {
  return `/api/usage/ingestion/export.csv?${ingestionParams(q)}`
}

export function overviewExportUrl(q: OverviewQuery): string {
  return `/api/usage/overview/export.csv?${overviewParams(q)}`
}
