// Saves the usage lists the Python services return (EV-03). The Python side never
// writes `ai_calls`; the gateway does it here.
// Called by section/ofi/summary.service.ts (drafting), speech.service.ts
// (Whisper), observation.service.ts (photo interpretation), ingestion.service.ts
// (labelling), rag.service.ts (chat) and routes/internal-ai-usage.routes.ts
// (the ingestion worker's OCR and embedding). Calls ai-pricing.service.ts for the cost.
import { Types } from 'mongoose'
import { AI_FEATURES, AiCallModel, BILLED_SERVICES, type IAiCall } from '../models/ai-call.model'
import { estimateCost } from './ai-pricing.service'
import type { InterpretationResult } from './speech.service'

// One usage item as the services send it. Must match the "Wire contract" in
// .local-docs/specs/sprint-2/EV-03.md and microservices/rag-service and speech-ocr-service.
export type WireUsage = {
  feature: IAiCall['feature']
  billed_service: IAiCall['billedService']
  model: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  search_units: number | null
  audio_seconds: number | null
  usage_status: IAiCall['usageStatus']
  // Only ingestion sends these: how many calls one item sums, and for which document.
  call_count?: number
  document_id?: string
  // Only labelling sends these: it prices its own calls (ingestion-service PRICES).
  cost_usd?: number | null
  pricing_basis?: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
// A malformed id is dropped, not saved: an id that matches nothing is worse than none.
const objectId = (v: unknown) =>
  typeof v === 'string' && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : undefined
const callCount = (v: unknown) => {
  const n = num(v)
  return n !== null && Number.isInteger(n) && n >= 1 ? n : 1
}

// What the caller knows that the service does not: which report, section, user or document.
export type CallContext = {
  reportId?: string
  section?: string
  userId?: string
  documentId?: string
}

// Turns the ingestion service's /label usage list into the common shape.
// Cost stays the one that service worked out, with its basis named.
export function labelUsageToWire(items: unknown): WireUsage[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((u) => u && typeof u.model === 'string')
    .map((u) => ({
      feature: 'label-document' as const,
      billed_service: labelProvider(u.model),
      model: u.model,
      duration_ms: num(u.seconds) === null ? null : Math.round(u.seconds * 1000),
      input_tokens: num(u.input_tokens),
      output_tokens: num(u.output_tokens),
      cache_read_tokens: null,
      search_units: null,
      audio_seconds: null,
      usage_status: 'recorded' as const,
      cost_usd: num(u.cost_usd),
      pricing_basis:
        'ingestion-service PRICES table (microservices/ingestion-service/app/labelling/config.py)',
    }))
}

// Which billed service a photo-interpretation provider is, by the name S5
// reports (VISION_PROVIDER picks it there). A provider not listed here has no
// price, so its call is not recorded; add it here when S5 gains one.
const VISION_SERVICES: Record<string, WireUsage['billed_service']> = {
  gemini: 'gemini-vision',
}

// Turns S5's photo-interpretation answer into one usage item. S5 sends no
// duration, so the caller times the request (S3 reads included).
export function visionUsageToWire(result: InterpretationResult, durationMs: number): WireUsage[] {
  const billed = VISION_SERVICES[result.provider]
  if (!billed) return []
  const usage = result.usage
  const output = num(usage?.output_tokens)
  return [
    {
      feature: 'interpret-photo',
      billed_service: billed,
      model: result.model,
      duration_ms: Math.round(durationMs),
      input_tokens: num(usage?.input_tokens),
      // Thinking is billed as output; without the answer's own count the sum would understate it.
      output_tokens: output === null ? null : output + (num(usage?.thought_tokens) ?? 0),
      cache_read_tokens: null,
      search_units: null,
      audio_seconds: null,
      usage_status: usage ? 'recorded' : 'unavailable',
    },
  ]
}

// Which vendor bills a labelling model.
function labelProvider(model: string): WireUsage['billed_service'] {
  if (model.startsWith('claude')) return 'anthropic'
  if (model === 'jev') return 'typesafe-jev'
  return 'openai-label'
}

// No amount at all means the provider reported nothing, whatever the sender says.
function isUnavailable(u: WireUsage): boolean {
  const amounts = [
    u.input_tokens,
    u.output_tokens,
    u.cache_read_tokens,
    u.search_units,
    u.audio_seconds,
  ]
  return u.usage_status === 'unavailable' || amounts.every((a) => num(a) === null)
}

/** Returns the cost of one usage item: its own cost_usd if sent, else the estimate. */
export function usageCost(u: WireUsage): { estimatedCostUsd: number | null; pricingBasis: string } {
  const unavailable = isUnavailable(u)
  if (!unavailable && typeof u.cost_usd === 'number') {
    return { estimatedCostUsd: u.cost_usd, pricingBasis: u.pricing_basis ?? 'service-supplied' }
  }
  return estimateCost(unavailable ? { ...u, usage_status: 'unavailable' } : u)
}

// Saves one row per valid item. Never throws: without this, a bookkeeping
// failure would turn a successful draft or transcription into an error.
export async function recordAiCalls(items: unknown, context: CallContext = {}): Promise<void> {
  if (!Array.isArray(items)) return
  try {
    const rows = items
      .filter(
        (u): u is WireUsage =>
          !!u &&
          (AI_FEATURES as readonly string[]).includes(u.feature) &&
          (BILLED_SERVICES as readonly string[]).includes(u.billed_service) &&
          typeof u.model === 'string',
      )
      .map((u) => {
        const unavailable = isUnavailable(u)
        const cost = usageCost(u)
        return {
          feature: u.feature,
          billedService: u.billed_service,
          model: u.model,
          reportId: context.reportId,
          section: context.section,
          userId: objectId(context.userId),
          documentId: objectId(u.document_id ?? context.documentId),
          callCount: callCount(u.call_count),
          durationMs: num(u.duration_ms),
          inputTokens: num(u.input_tokens),
          outputTokens: num(u.output_tokens),
          cacheReadTokens: num(u.cache_read_tokens),
          searchUnits: num(u.search_units),
          audioSeconds: num(u.audio_seconds),
          usageStatus: unavailable ? 'unavailable' : 'recorded',
          ...cost,
        }
      })
    if (rows.length) await AiCallModel.insertMany(rows, { ordered: false })
  } catch (error) {
    console.error('Recording AI-call usage failed:', error)
  }
}
