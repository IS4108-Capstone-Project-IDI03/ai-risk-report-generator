// Saves the usage lists the Python services return (EV-03). The Python side never
// writes to MongoDB; the gateway does it here.
// Called by section.service.ts (drafting), speech.service.ts (Whisper) and
// ingestion.service.ts (labelling). Calls ai-pricing.service.ts for the cost.
import { AI_FEATURES, AiCallModel, BILLED_SERVICES, type IAiCall } from '../models/ai-call.model'
import { estimateCost } from './ai-pricing.service'

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
  // Only labelling sends these: it prices its own calls (ingestion-service PRICES).
  cost_usd?: number | null
  pricing_basis?: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

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

// Which vendor bills a labelling model.
function labelProvider(model: string): WireUsage['billed_service'] {
  if (model.startsWith('claude')) return 'anthropic'
  if (model === 'jev') return 'typesafe-jev'
  return 'openai-label'
}

// Saves one row per valid item. Never throws: without this, a bookkeeping
// failure would turn a successful draft or transcription into an error.
export async function recordAiCalls(
  items: unknown,
  context: { reportId?: string } = {},
): Promise<void> {
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
        const amounts = [
          u.input_tokens,
          u.output_tokens,
          u.cache_read_tokens,
          u.search_units,
          u.audio_seconds,
        ]
        // No amount at all means the provider reported nothing, whatever the sender says.
        const unavailable =
          u.usage_status === 'unavailable' || amounts.every((a) => num(a) === null)
        const own = !unavailable && typeof u.cost_usd === 'number'
        const cost = own
          ? {
              estimatedCostUsd: u.cost_usd as number,
              pricingBasis: u.pricing_basis ?? 'service-supplied',
            }
          : estimateCost(unavailable ? { ...u, usage_status: 'unavailable' } : u)
        return {
          feature: u.feature,
          billedService: u.billed_service,
          model: u.model,
          reportId: context.reportId,
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
