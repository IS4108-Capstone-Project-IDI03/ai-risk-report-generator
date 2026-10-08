// Turns the usage of one AI call into an estimated dollar cost (EV-03 AC3).
// Called by ai-usage.service.ts. The prices are list prices: an estimate, not
// an invoice. Update the table (and its date) when a vendor changes prices.
import { config } from '../config'
import type { WireUsage } from './ai-usage.service'

type TokenPrice = { in: number; out: number; cacheRead: number }

// USD per 1M tokens. Source: platform.claude.com/docs/en/about-claude/pricing,
// read 2026-10-08. Longest matching key wins, so dated ids like
// claude-haiku-4-5-20251001 match claude-haiku-4-5.
// ponytail: Haiku 5.5 costs more for prompts over 100k tokens; drafting and
// labelling stay far below that. Add a tier here if that changes.
const CLAUDE_PRICES: Record<string, TokenPrice> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
}
const CLAUDE_BASIS =
  'Anthropic list price, platform.claude.com/docs/en/about-claude/pricing, 2026-10-08'
// ponytail: OpenAI's page gives no rounding rule for whisper-1, so we bill the exact seconds.
const WHISPER_USD_PER_MINUTE = 0.006
const WHISPER_BASIS = 'OpenAI list price, developers.openai.com/api/docs/pricing, 2026-10-08'
// Cohere publishes no per-use price for these models (cohere.com/pricing lists only
// dedicated-instance rates), so these are estimates Chris supplied, overridable in .env.
const COHERE_BASIS = 'estimate supplied by Chris, not confirmed on cohere.com/pricing, 2026-10-08'

type Cost = { estimatedCostUsd: number | null; pricingBasis: string }
const unpriced = (pricingBasis: string): Cost => ({ estimatedCostUsd: null, pricingBasis })

/** Returns the estimated cost of one call and the basis of the price used. */
export function estimateCost(call: WireUsage): Cost {
  if (call.usage_status === 'unavailable') return unpriced('provider gave no usage')

  switch (call.billed_service) {
    case 'anthropic': {
      const key = Object.keys(CLAUDE_PRICES)
        .filter((k) => call.model.startsWith(k))
        .sort((a, b) => b.length - a.length)[0]
      if (!key) return unpriced('no price for model')
      // Without both counts the sum would silently drop a term and look like a real cost.
      if (call.input_tokens == null || call.output_tokens == null)
        return unpriced('incomplete usage')
      const p = CLAUDE_PRICES[key]
      const usd =
        (call.input_tokens * p.in +
          call.output_tokens * p.out +
          (call.cache_read_tokens ?? 0) * p.cacheRead) /
        1e6
      return { estimatedCostUsd: usd, pricingBasis: CLAUDE_BASIS }
    }
    case 'cohere-embed':
      if (call.input_tokens == null) return unpriced('incomplete usage')
      return {
        estimatedCostUsd: (call.input_tokens * config.prices.cohereEmbedUsdPer1M) / 1e6,
        pricingBasis: COHERE_BASIS,
      }
    case 'cohere-rerank':
      if (call.search_units == null) return unpriced('incomplete usage')
      return {
        estimatedCostUsd: (call.search_units * config.prices.cohereRerankUsdPer1K) / 1000,
        pricingBasis: COHERE_BASIS,
      }
    case 'openai-whisper':
      if (call.audio_seconds == null) return unpriced('no audio length reported')
      return {
        estimatedCostUsd: (call.audio_seconds / 60) * WHISPER_USD_PER_MINUTE,
        pricingBasis: WHISPER_BASIS,
      }
    default:
      return unpriced('no price for service')
  }
}
