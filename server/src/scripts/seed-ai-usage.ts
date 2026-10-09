// Writes clearly fake ai_calls rows so the Usage and costs screen (EV-04) can be
// tried without paying for any AI call. Run: npm --prefix server run seed:usage
// Rows are tagged "DEMO data" in pricingBasis and replaced on every run.
import 'dotenv/config'
import mongoose from 'mongoose'
import { AiCallModel, type IAiCall } from '../models/ai-call.model'
import { connectDb } from '../models/db'
import { estimateCost } from '../services/ai-pricing.service'
import type { WireUsage } from '../services/ai-usage.service'

// The sample assessments that `npm run seed` creates.
const REPORTS = ['RPT-2026-0411', 'RPT-2026-0408', 'RPT-2026-0327']

const wire = (over: Partial<WireUsage>): WireUsage => ({
  feature: 'draft-section',
  billed_service: 'anthropic',
  model: 'claude-opus-5-5',
  duration_ms: 30000,
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
  ...over,
})

// Turns a wire item into a stored row, priced the way the gateway prices it.
function row(reportId: string | undefined, call: WireUsage): Omit<IAiCall, 'createdAt'> {
  const cost = estimateCost(call)
  return {
    feature: call.feature,
    billedService: call.billed_service,
    model: call.model,
    reportId,
    durationMs: call.duration_ms,
    inputTokens: call.input_tokens,
    outputTokens: call.output_tokens,
    cacheReadTokens: call.cache_read_tokens,
    searchUnits: call.search_units,
    audioSeconds: call.audio_seconds,
    usageStatus: call.usage_status,
    estimatedCostUsd: cost.estimatedCostUsd,
    pricingBasis: `DEMO data - ${cost.pricingBasis}`,
  }
}

async function seed(): Promise<void> {
  await connectDb()
  const removed = await AiCallModel.deleteMany({ pricingBasis: /^DEMO data/ })
  const rows: ReturnType<typeof row>[] = []

  REPORTS.forEach((report, i) => {
    // Three section drafts: each is one Claude call plus a Cohere embed and rerank.
    for (let n = 0; n < 3; n++) {
      const size = 1 + ((i + n) % 3)
      rows.push(
        row(
          report,
          wire({
            duration_ms: 18000 + size * 9000,
            input_tokens: 6000 * size,
            output_tokens: 1800 * size,
            cache_read_tokens: 4000 * (n % 2),
          }),
        ),
        row(
          report,
          wire({
            feature: 'retrieval',
            billed_service: 'cohere-embed',
            model: 'embed-v4.0',
            duration_ms: 250 + n * 40,
            input_tokens: 40 + n * 10,
          }),
        ),
        row(
          report,
          wire({
            feature: 'retrieval',
            billed_service: 'cohere-rerank',
            model: 'rerank-v3.5',
            duration_ms: 600 + n * 90,
            search_units: 1,
          }),
        ),
      )
    }
    // Two voice notes (Whisper bills by audio length; there are no tokens).
    for (let n = 0; n < 2; n++) {
      rows.push(
        row(
          report,
          wire({
            feature: 'transcribe',
            billed_service: 'openai-whisper',
            model: 'whisper-1',
            duration_ms: 3000 + n * 1500,
            audio_seconds: 40 + 35 * n + 10 * i,
          }),
        ),
      )
    }
  })
  // One call whose provider gave no usage, to see the "no cost" notice.
  rows.push(
    row(REPORTS[0], wire({ input_tokens: null, output_tokens: null, usage_status: 'unavailable' })),
  )
  // Document labelling has no report; it prices itself, so its cost is stored as given.
  for (const [model, service, cost] of [
    ['claude-haiku-5-5', 'anthropic', 0.0011],
    ['jev', 'typesafe-jev', 0.00038],
  ] as const) {
    rows.push({
      ...row(
        undefined,
        wire({
          feature: 'label-document',
          billed_service: service,
          model,
          duration_ms: 2400,
          input_tokens: 9000,
          output_tokens: model === 'jev' ? 0 : 400,
        }),
      ),
      estimatedCostUsd: cost,
      pricingBasis: 'DEMO data - ingestion-service PRICES table',
    })
  }

  await AiCallModel.insertMany(rows)
  console.log(`Replaced ${removed.deletedCount} demo rows with ${rows.length} new ones.`)
  await mongoose.disconnect()
}

seed().catch((error) => {
  console.error(error)
  process.exit(1)
})
