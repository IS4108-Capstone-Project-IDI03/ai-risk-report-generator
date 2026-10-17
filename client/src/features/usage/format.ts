// Display helpers for the Usage and costs screen (EV-04): names, money, time, counts.
// Used by every component in components/.
import type { UsageView } from './api'

export const DASH = '–'

export const FEATURE_LABELS: Record<string, string> = {
  'draft-section': 'Drafting',
  retrieval: 'Retrieval (search)',
  transcribe: 'Voice transcription',
  'label-document': 'Document labelling',
  'interpret-photo': 'Photo interpretation',
  ocr: 'Table and formula OCR',
  'embed-document': 'Document embedding',
  chat: 'Chatbot',
}

export const SERVICE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  'cohere-embed': 'Cohere embeddings',
  'cohere-rerank': 'Cohere rerank',
  'openai-whisper': 'OpenAI Whisper',
  'openai-label': 'OpenAI labelling',
  openai: 'OpenAI chat',
  'typesafe-jev': 'Typesafe JEV',
  'gemini-vision': 'Gemini photo reading',
  'gemini-ocr': 'Gemini OCR',
  'self-hosted-ocr': 'Self-hosted OCR',
}

// A knowledge document's ingestion status, as the knowledge base names it.
// No status means the document was never stored.
const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
export function statusLabel(status: string | null): string {
  return status ? (STATUS_LABELS[status] ?? status) : 'Not saved'
}

// Friendly name for a row key; an unknown key is shown as it came.
export function rowLabel(view: UsageView, key: string): string {
  return (view === 'feature' ? FEATURE_LABELS : SERVICE_LABELS)[key] ?? key
}

// US dollars. Small amounts keep 4 decimals so $0.0123 does not read as $0.01;
// below that, a real cost says so rather than reading as free.
export function formatMoney(usd: number): string {
  if (!Number.isFinite(usd)) return DASH
  if (usd > 0 && usd < 0.00005) return '< $0.0001'
  return `$${usd.toFixed(usd !== 0 && Math.abs(usd) < 1 ? 4 : 2)}`
}

// An axis tick: as short as the scale allows ($0, $0.85, $3.40, $12, $1.2K), so
// ticks stay clean where a table cell keeps four decimals.
export function formatAxisMoney(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0'
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
  if (usd >= 10) return `$${Math.round(usd)}`
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`
}

// A count with thousands separators; zero or missing is a dash, not 0 noise.
export function formatCount(n: number): string {
  return n > 0 ? n.toLocaleString('en-US') : DASH
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

// Tokens, short (1.6M) for a table cell; none is a dash. Pair with the full
// count in a title so the exact figure is a hover away.
export function formatTokens(n: number): string {
  return n > 0 ? COMPACT.format(n) : DASH
}

// A cost line's quantity in its own unit: "200,000 tokens", "140 searches", "12.5 min".
export function formatQuantity(quantity: number, unit: 'tokens' | 'searches' | 'minutes'): string {
  if (unit === 'minutes') return `${quantity.toFixed(1)} min`
  return `${Math.round(quantity).toLocaleString('en-US')} ${unit}`
}

const RATE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})
const PER_LABELS: Record<number, string> = { 1_000_000: '1M ', 1000: '1K ', 1: '' }

// A rate as the vendor states it: "$2.00 / 1M tokens", "$2.00 / 1K searches", "$0.006 / min".
export function formatRate(
  usdPer: number,
  per: number,
  unit: 'tokens' | 'searches' | 'minutes',
): string {
  const perLabel = PER_LABELS[per] ?? `${per.toLocaleString('en-US')} `
  return `${RATE.format(usdPer)} / ${perLabel}${unit === 'minutes' ? 'min' : unit}`
}

export function formatMinutes(seconds: number): string {
  return seconds > 0 ? (seconds / 60).toFixed(1) : DASH
}

// Milliseconds as "850 ms" or "1.2 s"; null (no data) is a dash.
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return DASH
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
