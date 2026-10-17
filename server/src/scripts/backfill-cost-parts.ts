// Stores the rates on ai_calls rows (EV-03) saved before each call kept them
// (EV-04), so the cost report can show how their cost was made up. A row gets
// today's rates only when they reproduce its stored cost exactly; a row saved
// at an earlier price is left without, and the report says its rates were not
// recorded. Rows with no cost have nothing to explain and are skipped.
// Safe to run more than once: a row with rates is skipped.
//   npm --prefix server run migrate:cost-parts
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { AiCallModel, type CostPart } from '../models/ai-call.model'
import { estimateCost, tokenPartsAt } from '../services/ai-pricing.service'

// Labelling's prices as the ingestion service had them when this script was
// written (labelling/config.py PRICES, USD per 1M tokens): new labelling calls
// carry their own rates, so this copy is never updated.
const LABEL_PRICES_2026_10_18: Record<string, [number, number]> = {
  jev: [0.042, 0],
  'openai-decisions': [0.1, 0],
  'claude-haiku-4-5': [1, 5],
  'claude-haiku-5-5': [0.1, 0.5],
  'gpt-6-luna': [0.1, 0.5],
}
// Rounding in different orders leaves dust far below a cent.
const SAME_COST_USD = 1e-9

type Row = Awaited<ReturnType<typeof oldRows>>[number]
const oldRows = () =>
  AiCallModel.find({ costParts: { $exists: false }, estimatedCostUsd: { $ne: null } }).lean()

function partsFor(r: Row): CostPart[] | null {
  if (r.pricingBasis.startsWith('ingestion-service')) {
    const rates = LABEL_PRICES_2026_10_18[r.model]
    return rates ? tokenPartsAt(rates[0], rates[1], r.inputTokens ?? 0, r.outputTokens ?? 0) : null
  }
  return estimateCost(
    {
      feature: r.feature,
      billed_service: r.billedService,
      model: r.model,
      duration_ms: r.durationMs,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cache_read_tokens: r.cacheReadTokens,
      search_units: r.searchUnits,
      audio_seconds: r.audioSeconds,
      usage_status: r.usageStatus,
    },
    r.createdAt,
  ).costParts
}

export async function backfillCostParts(): Promise<{ stored: number; left: number }> {
  const rows = await oldRows()
  let stored = 0
  for (const r of rows) {
    const parts = partsFor(r)
    const total = parts?.reduce((t, p) => t + p.costUsd, 0)
    if (total === undefined || Math.abs(total - (r.estimatedCostUsd ?? 0)) > SAME_COST_USD) continue
    const updated = await AiCallModel.updateOne(
      { _id: r._id, costParts: { $exists: false } },
      { $set: { costParts: parts } },
    )
    stored += updated.modifiedCount
  }
  return { stored, left: rows.length - stored }
}

async function migrate() {
  await connectDb()
  const result = await backfillCostParts()
  console.log(`Calls given their rates: ${result.stored}. Left without: ${result.left}.`)
  await mongoose.disconnect()
}

// Run from the command line; a test imports backfillCostParts alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
