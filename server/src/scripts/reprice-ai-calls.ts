// Prices the ai_calls rows (EV-03) saved with no cost because their model had
// no price then, e.g. claude-sonnet-5-5 before it was added to
// ai-pricing.service.ts. A row is priced as of the day it was made. Rows
// still without a price are left as they are.
// Safe to run more than once: a priced row is skipped.
//   npm --prefix server run migrate:prices
import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../models/db'
import { AiCallModel } from '../models/ai-call.model'
import { estimateCost } from '../services/ai-pricing.service'

export async function repriceAiCalls() {
  const rows = await AiCallModel.find({
    estimatedCostUsd: null,
    pricingBasis: 'no price for model',
  }).lean()
  let priced = 0
  for (const r of rows) {
    const cost = estimateCost(
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
    )
    if (cost.estimatedCostUsd === null) continue
    const updated = await AiCallModel.updateOne(
      { _id: r._id, estimatedCostUsd: null },
      { $set: cost },
    )
    priced += updated.modifiedCount
  }
  return { priced, unpriced: rows.length - priced }
}

async function migrate() {
  await connectDb()
  const result = await repriceAiCalls()
  console.log(`Calls priced: ${result.priced}. Still no price: ${result.unpriced}.`)
  await mongoose.disconnect()
}

// Run from the command line; a test imports repriceAiCalls alone.
if (require.main === module) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
