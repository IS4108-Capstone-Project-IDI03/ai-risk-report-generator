// Display helpers for the Usage and costs screen (EV-04): names, money, time, counts.
// Used by every component in components/.
import type { UsageView } from './api'

export const DASH = '–'

export const FEATURE_LABELS: Record<string, string> = {
  'draft-section': 'Drafting',
  retrieval: 'Retrieval (search)',
  transcribe: 'Voice transcription',
  'label-document': 'Document labelling',
}

export const SERVICE_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  'cohere-embed': 'Cohere embeddings',
  'cohere-rerank': 'Cohere rerank',
  'openai-whisper': 'OpenAI Whisper',
  'openai-label': 'OpenAI labelling',
  'typesafe-jev': 'Typesafe JEV',
}

// Friendly name for a row key; an unknown key is shown as it came.
export function rowLabel(view: UsageView, key: string): string {
  return (view === 'feature' ? FEATURE_LABELS : SERVICE_LABELS)[key] ?? key
}

// US dollars. Small amounts keep 4 decimals so $0.0123 does not read as $0.01.
export function formatMoney(usd: number): string {
  if (!Number.isFinite(usd)) return DASH
  return `$${usd.toFixed(usd !== 0 && Math.abs(usd) < 1 ? 4 : 2)}`
}

// A count with thousands separators; zero or missing is a dash, not 0 noise.
export function formatCount(n: number): string {
  return n > 0 ? n.toLocaleString('en-US') : DASH
}

export function formatMinutes(seconds: number): string {
  return seconds > 0 ? (seconds / 60).toFixed(1) : DASH
}

// Milliseconds as "850 ms" or "1.2 s"; null (no data) is a dash.
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return DASH
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
