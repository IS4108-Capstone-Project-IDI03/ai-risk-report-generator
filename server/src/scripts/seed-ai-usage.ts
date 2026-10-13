// Writes clearly fake ai_calls rows so the Usage and costs screen (EV-04) can be
// tried without paying for any AI call. Run after `npm run seed`:
// npm --prefix server run seed:usage (or seed:all for both).
// Rows are tagged "DEMO data" in pricingBasis and replaced on every run. Every
// row belongs to something `npm run seed` made: report calls to its sample
// assessments, chat calls to its sample engineers. There are no ingestion rows
// (the seed makes no knowledge documents), so the Ingestion tab shows only real
// uploads. Discarding the samples later means deleting these rows too: see
// docs/RUNNING.md.
import 'dotenv/config'
import mongoose, { Types } from 'mongoose'
import { AiCallModel, type IAiCall } from '../models/ai-call.model'
import { connectDb } from '../models/db'
import { UserModel } from '../models/user.model'
import { estimateCost } from '../services/ai-pricing.service'
import type { WireUsage } from '../services/ai-usage.service'

// The sample assessments that `npm run seed` creates, and the sections drafted for each.
const REPORTS: { reference: string; sections: string[] }[] = [
  { reference: 'RPT-2026-0411', sections: ['7', '8', '9', '9', '3', '2'] },
  { reference: 'RPT-2026-0408', sections: ['7', '10', '11', '3'] },
  { reference: 'RPT-2026-0327', sections: ['7', '12'] },
]
// The sample engineers who ask the chatbot, by staff ID, and how many questions each.
const ASKERS: [string, number][] = [
  ['MRE-0001', 6],
  ['MRE-0002', 3],
  ['MRE-0003', 2],
]
const DEMO = 'DEMO data'
const DAY_MS = 86_400_000

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

type Row = Omit<IAiCall, 'createdAt'> & { createdAt: Date }

// Turns a wire item into a stored row, priced the way the gateway prices it,
// made `daysAgo` days ago so the period filters have something to separate.
function row(
  call: WireUsage,
  daysAgo: number,
  where: { reportId?: string; section?: string; userId?: Types.ObjectId } = {},
): Row {
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS)
  const cost = estimateCost(call, createdAt)
  return {
    feature: call.feature,
    billedService: call.billed_service,
    model: call.model,
    ...where,
    callCount: 1,
    durationMs: call.duration_ms,
    inputTokens: call.input_tokens,
    outputTokens: call.output_tokens,
    cacheReadTokens: call.cache_read_tokens,
    searchUnits: call.search_units,
    audioSeconds: call.audio_seconds,
    usageStatus: call.usage_status,
    estimatedCostUsd: cost.estimatedCostUsd,
    pricingBasis: `${DEMO} - ${cost.pricingBasis}`,
    createdAt,
  }
}

// One section draft: a Claude call and the Cohere embed and rerank for its evidence.
function draft(reportId: string, section: string, size: number, daysAgo: number): Row[] {
  const where = { reportId, section }
  return [
    row(
      wire({
        duration_ms: 18000 + size * 9000,
        input_tokens: 6000 * size,
        output_tokens: 1800 * size,
        cache_read_tokens: 4000 * (size % 2),
      }),
      daysAgo,
      where,
    ),
    row(
      wire({
        feature: 'retrieval',
        billed_service: 'cohere-embed',
        model: 'embed-v4.0',
        duration_ms: 250 + size * 40,
        input_tokens: 40 + size * 10,
      }),
      daysAgo,
      where,
    ),
    row(
      wire({
        feature: 'retrieval',
        billed_service: 'cohere-rerank',
        model: 'rerank-v3.5',
        duration_ms: 600 + size * 90,
        search_units: 1,
      }),
      daysAgo,
      where,
    ),
  ]
}

async function seed(): Promise<void> {
  await connectDb()
  const removed = await AiCallModel.deleteMany({ pricingBasis: /^DEMO data/ })
  const rows: Row[] = []

  REPORTS.forEach(({ reference, sections }, i) => {
    // Drafts spread over the last four weeks, newest assessment most recent.
    sections.forEach((section, n) =>
      rows.push(...draft(reference, section, 1 + ((i + n) % 3), 2 + i * 12 + n * 3)),
    )
    // Two voice notes (Whisper bills by audio length; there are no tokens).
    for (let n = 0; n < 2; n++)
      rows.push(
        row(
          wire({
            feature: 'transcribe',
            billed_service: 'openai-whisper',
            model: 'whisper-1',
            duration_ms: 3000 + n * 1500,
            audio_seconds: 40 + 35 * n + 10 * i,
          }),
          4 + i * 12 + n,
          { reportId: reference },
        ),
      )
    // Photos read by Gemini; thinking is billed as output.
    for (let n = 0; n < 3 - i; n++)
      rows.push(
        row(
          wire({
            feature: 'interpret-photo',
            billed_service: 'gemini-vision',
            model: 'gemini-3.8-flash',
            duration_ms: 6500 + n * 700,
            input_tokens: 2064 + n * 300,
            output_tokens: 228 + n * 40,
          }),
          5 + i * 12 + n,
          { reportId: reference },
        ),
      )
  })

  // One call whose provider gave no usage, to see the "no cost" notice.
  rows.push(
    row(wire({ input_tokens: null, output_tokens: null, usage_status: 'unavailable' }), 3, {
      reportId: REPORTS[0].reference,
      section: '8',
    }),
  )

  // Chat questions from the sample engineers: one Cohere embed each.
  for (const [staffId, questions] of ASKERS) {
    const user = await UserModel.findOne({ staffId }, '_id').lean()
    if (!user) {
      console.log(`No ${staffId} account (run \`npm run seed\` first); skipping their chat.`)
      continue
    }
    for (let n = 0; n < questions; n++)
      rows.push(
        row(
          wire({
            feature: 'chat',
            billed_service: 'cohere-embed',
            model: 'embed-v4.0',
            duration_ms: 300 + n * 25,
            input_tokens: 12 + n * 3,
          }),
          1 + n * 5,
          { userId: user._id as Types.ObjectId },
        ),
      )
  }

  // Straight to the collection: saving through the model would stamp every row "now".
  await AiCallModel.collection.insertMany(rows)
  console.log(`Replaced ${removed.deletedCount} demo rows with ${rows.length} new ones.`)
  await mongoose.disconnect()
}

seed().catch((error) => {
  console.error(error)
  process.exit(1)
})
