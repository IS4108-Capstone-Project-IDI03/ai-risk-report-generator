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
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
}
const CLAUDE_BASIS =
  'Anthropic list price, platform.claude.com/docs/en/about-claude/pricing, 2026-10-08'
// USD per 1M tokens for the chat's OpenAI models (CB-01), same longest-prefix rule.
// ponytail: no cache-read price was given, so cached tokens are billed at the full input price.
const OPENAI_PRICES: Record<string, TokenPrice> = {
  'gpt-6.1-sol': { in: 2, out: 10, cacheRead: 2 },
  'gpt-6-luna': { in: 0.1, out: 0.5, cacheRead: 0.1 },
}
const OPENAI_BASIS = 'OpenAI list price, developers.openai.com/api/docs/pricing, 2026-10-13'
// ponytail: OpenAI's page gives no rounding rule for whisper-1, so we bill the exact seconds.
const WHISPER_USD_PER_MINUTE = 0.006
const WHISPER_BASIS = 'OpenAI list price, developers.openai.com/api/docs/pricing, 2026-10-08'
// Cohere publishes no per-use price for these models (cohere.com/pricing lists only
// dedicated-instance rates), so these are estimates Chris supplied, overridable in .env.
const COHERE_BASIS = 'estimate supplied by Chris, not confirmed on cohere.com/pricing, 2026-10-08'
const COHERE_TRIAL_BASIS =
  'Cohere trial key: free, 1,000 calls a month (docs.cohere.com/docs/rate-limits, 2026-10-13)'
// USD per 1M tokens, paid tier (thinking tokens bill as output). Source:
// ai.google.dev/gemini-api/docs/pricing, read 2026-10-13. Google announced a
// price rise from 2027-01-01, so each model lists its prices with the date
// they start; a call is priced at the one in force when it was made.
type DatedPrice = { from: string; in: number; out: number }
const GEMINI_PRICES: Record<string, DatedPrice[]> = {
  'gemini-3.8-flash': [
    { from: '2027-01-01', in: 1.5, out: 7.5 },
    { from: '0000-01-01', in: 0.75, out: 3.75 },
  ],
}
const GEMINI_BASIS = 'Google list price, ai.google.dev/gemini-api/docs/pricing, 2026-10-13'
const SELF_HOSTED_BASIS = 'self-hosted model, no per-call price'

type Cost = { estimatedCostUsd: number | null; pricingBasis: string }
const unpriced = (pricingBasis: string): Cost => ({ estimatedCostUsd: null, pricingBasis })

// The entry for the longest key the model id starts with, so dated or
// suffixed ids (claude-haiku-4-5-20251001) match their base model.
function priceFor<T>(table: Record<string, T>, model: string): T | undefined {
  const key = Object.keys(table)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key ? table[key] : undefined
}

// Prices a token-billed call from a model table (Claude or OpenAI).
function tokenCost(call: WireUsage, prices: Record<string, TokenPrice>, basis: string): Cost {
  const p = priceFor(prices, call.model)
  if (!p) return unpriced('no price for model')
  // Without both counts the sum would silently drop a term and look like a real cost.
  if (call.input_tokens == null || call.output_tokens == null) return unpriced('incomplete usage')
  const usd =
    (call.input_tokens * p.in +
      call.output_tokens * p.out +
      (call.cache_read_tokens ?? 0) * p.cacheRead) /
    1e6
  return { estimatedCostUsd: usd, pricingBasis: basis }
}

/** Returns the estimated cost of one call made at `at`, and the basis of the price used. */
export function estimateCost(call: WireUsage, at: Date = new Date()): Cost {
  // Free whatever it reports, so a reading with no token counts is $0, not uncosted.
  if (call.billed_service === 'self-hosted-ocr')
    return { estimatedCostUsd: 0, pricingBasis: SELF_HOSTED_BASIS }
  const cohere = call.billed_service === 'cohere-embed' || call.billed_service === 'cohere-rerank'
  if (cohere && config.prices.cohereKeyTier === 'trial')
    return { estimatedCostUsd: 0, pricingBasis: COHERE_TRIAL_BASIS }
  if (call.usage_status === 'unavailable') return unpriced('provider gave no usage')

  switch (call.billed_service) {
    case 'anthropic':
      return tokenCost(call, CLAUDE_PRICES, CLAUDE_BASIS)
    case 'openai':
      return tokenCost(call, OPENAI_PRICES, OPENAI_BASIS)
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
    case 'gemini-vision':
    case 'gemini-ocr': {
      const dated = priceFor(GEMINI_PRICES, call.model)
      if (!dated) return unpriced('no price for model')
      if (call.input_tokens == null || call.output_tokens == null)
        return unpriced('incomplete usage')
      const day = at.toISOString().slice(0, 10)
      const p = dated.find((d) => d.from <= day) ?? dated[dated.length - 1]
      return {
        estimatedCostUsd: (call.input_tokens * p.in + call.output_tokens * p.out) / 1e6,
        pricingBasis: GEMINI_BASIS,
      }
    }
    default:
      return unpriced('no price for service')
  }
}
