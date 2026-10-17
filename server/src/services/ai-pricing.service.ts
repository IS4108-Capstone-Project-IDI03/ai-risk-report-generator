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
// Labelling is priced by the ingestion service itself (labelling/config.py
// PRICES, USD per 1M tokens, no cache term); copied here only so the report can
// show its calculation. Keep the two in step.
const LABEL_PRICES: Record<string, { in: number; out: number }> = {
  jev: { in: 0.042, out: 0 },
  'openai-decisions': { in: 0.1, out: 0 },
  'gpt-6-luna': { in: 0.1, out: 0.5 },
}

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

// What a call used, as the report reads it from ai_calls.
export type Amounts = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  searchUnits: number | null
  audioSeconds: number | null
}
// One billed part of a call: quantity × usdPer / per = costUsd (EV-04).
export type PricedPart = {
  part: 'input' | 'output' | 'cached input' | 'searches' | 'audio'
  unit: 'tokens' | 'searches' | 'minutes'
  quantity: number
  usdPer: number
  per: number
  costUsd: number
  // Why a rate is $0, for a reader checking the sum; null otherwise.
  note: string | null
}

const part = (
  name: PricedPart['part'],
  unit: PricedPart['unit'],
  quantity: number,
  usdPer: number,
  per: number,
  note: string | null = null,
): PricedPart => ({
  part: name,
  unit,
  quantity,
  usdPer,
  per,
  costUsd: (quantity * usdPer) / per,
  note,
})
const totalOf = (parts: PricedPart[]) => parts.reduce((t, p) => t + p.costUsd, 0)

// The three token parts of a Claude or OpenAI call, per 1M tokens.
function tokenParts(p: TokenPrice, input: number, output: number, cached: number): PricedPart[] {
  return [
    part('input', 'tokens', input, p.in, 1e6),
    part('output', 'tokens', output, p.out, 1e6),
    part('cached input', 'tokens', cached, p.cacheRead, 1e6),
  ]
}

/**
 * Returns how a call's cost is made up, part by part (quantity × rate), or
 * null when it has no price. estimateCost prices through the same parts, so
 * the calculation the report shows matches the cost it stored.
 */
export function costBreakdown(
  billedService: string,
  model: string,
  amounts: Amounts,
  at: Date = new Date(),
): PricedPart[] | null {
  const input = amounts.inputTokens ?? 0
  const output = amounts.outputTokens ?? 0
  const cached = amounts.cacheReadTokens ?? 0
  switch (billedService) {
    case 'anthropic': {
      const p = priceFor(CLAUDE_PRICES, model)
      return p ? tokenParts(p, input, output, cached) : null
    }
    case 'openai': {
      // OpenAI's input includes the cached tokens, so only the rest is billed as input.
      const p = priceFor(OPENAI_PRICES, model)
      return p ? tokenParts(p, input - cached, output, cached) : null
    }
    case 'openai-whisper':
      return [part('audio', 'minutes', (amounts.audioSeconds ?? 0) / 60, WHISPER_USD_PER_MINUTE, 1)]
    case 'cohere-embed':
    case 'cohere-rerank': {
      const trial = config.prices.cohereKeyTier === 'trial'
      const note = trial ? 'Trial key: free' : null
      return billedService === 'cohere-embed'
        ? [part('input', 'tokens', input, trial ? 0 : config.prices.cohereEmbedUsdPer1M, 1e6, note)]
        : [
            part(
              'searches',
              'searches',
              amounts.searchUnits ?? 0,
              trial ? 0 : config.prices.cohereRerankUsdPer1K,
              1000,
              note,
            ),
          ]
    }
    case 'gemini-vision':
    case 'gemini-ocr': {
      const p = geminiPrice(model, at)
      return p
        ? [part('input', 'tokens', input, p.in, 1e6), part('output', 'tokens', output, p.out, 1e6)]
        : null
    }
    case 'self-hosted-ocr':
      return [
        part('input', 'tokens', input, 0, 1e6, 'Self-hosted'),
        part('output', 'tokens', output, 0, 1e6, 'Self-hosted'),
      ]
    case 'openai-label':
    case 'typesafe-jev': {
      const p = priceFor(LABEL_PRICES, model)
      return p
        ? [part('input', 'tokens', input, p.in, 1e6), part('output', 'tokens', output, p.out, 1e6)]
        : null
    }
    default:
      return null
  }
}

// The Gemini price in force on the day a call was made.
function geminiPrice(model: string, at: Date): DatedPrice | null {
  const dated = priceFor(GEMINI_PRICES, model)
  if (!dated) return null
  const day = at.toISOString().slice(0, 10)
  return dated.find((d) => d.from <= day) ?? dated[dated.length - 1]
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

  const basis = PRICED_BASES[call.billed_service]
  if (!basis) return unpriced('no price for service')
  const parts = costBreakdown(
    call.billed_service,
    call.model,
    {
      inputTokens: call.input_tokens,
      outputTokens: call.output_tokens,
      cacheReadTokens: call.cache_read_tokens,
      searchUnits: call.search_units,
      audioSeconds: call.audio_seconds,
    },
    at,
  )
  if (!parts) return unpriced('no price for model')
  const missing = missingUsage(call)
  if (missing) return unpriced(missing)
  return { estimatedCostUsd: totalOf(parts), pricingBasis: basis }
}

// The services estimateCost prices, and where each price came from. Labelling
// is priced by the ingestion service, so it is not here.
const PRICED_BASES: Record<string, string> = {
  anthropic: CLAUDE_BASIS,
  openai: OPENAI_BASIS,
  'cohere-embed': COHERE_BASIS,
  'cohere-rerank': COHERE_BASIS,
  'openai-whisper': WHISPER_BASIS,
  'gemini-vision': GEMINI_BASIS,
  'gemini-ocr': GEMINI_BASIS,
}

// Why a call's usage is too incomplete to price, or null. Without every
// amount its price needs, the sum would silently drop a term and look real.
function missingUsage(call: WireUsage): string | null {
  switch (call.billed_service) {
    case 'cohere-embed':
      return call.input_tokens == null ? 'incomplete usage' : null
    case 'cohere-rerank':
      return call.search_units == null ? 'incomplete usage' : null
    case 'openai-whisper':
      return call.audio_seconds == null ? 'no audio length reported' : null
    default:
      return call.input_tokens == null || call.output_tokens == null ? 'incomplete usage' : null
  }
}
