// The demo seed's AI usage rows (Usage and Costs, EV-04) and notifications (Inbox and bell, F-10).
// Called by seed-demo.ts. Makes no AI call: the rows are clearly fake, tagged "DEMO data" in
// pricingBasis, and priced the way the gateway prices real ones (ai-pricing.service.ts).
import { Types } from 'mongoose'
import { AiCallModel, type IAiCall } from '../models/ai-call.model'
import { KnowledgeGapRequestModel } from '../models/knowledge-gap-request.model'
import { NotificationModel } from '../models/notification.model'
import { estimateCost } from '../services/ai-pricing.service'
import type { WireUsage } from '../services/ai-usage.service'
import { USERS } from './seed-demo-data'

const DAY_MS = 86_400_000
const DEMO = 'DEMO data'
// Marks the notifications this seed made, so a re-run replaces them and nothing else.
export const SEED_SERVICE = 'seed-demo'

type Row = Omit<IAiCall, 'createdAt'> & { createdAt: Date }

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

// A stored row, priced as the gateway prices it, made `daysAgo` days ago.
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
    costParts: cost.costParts,
    createdAt,
  }
}

// One section draft: a Claude call, plus the Cohere embed and rerank for its evidence.
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

// The sections drafted for each report, and how long ago, so the period filters have something to split.
const REPORTS: { reference: string; sections: string[]; daysAgo: number; photos: number }[] = [
  { reference: 'RPT-2026-0001', sections: ['7', '8', '9', '10'], daysAgo: 225, photos: 1 },
  {
    reference: 'RPT-2026-0002',
    sections: ['7', '8', '9', '10', '4', '5', '6', '11', '12', '2'],
    daysAgo: 50,
    photos: 2,
  },
  { reference: 'RPT-2026-0003', sections: ['7', '8', '9', '10'], daysAgo: 6, photos: 3 },
  { reference: 'RPT-2026-0004', sections: [], daysAgo: 1, photos: 3 },
]

/** Replaces the seed's AI usage rows with new ones; returns how many it wrote. */
export async function seedUsage(userIds: Record<string, Types.ObjectId>): Promise<number> {
  await AiCallModel.deleteMany({ pricingBasis: new RegExp(`^${DEMO}`) })
  const rows: Row[] = []
  for (const [i, { reference, sections, daysAgo, photos }] of REPORTS.entries()) {
    sections.forEach((s, n) =>
      rows.push(...draft(reference, s, 1 + ((i + n) % 3), daysAgo + n * 0.1)),
    )
    // Two voice notes: Whisper bills by audio length, with no tokens.
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
          daysAgo + 1 + n,
          { reportId: reference },
        ),
      )
    // Photos read by Gemini; thinking is billed as output.
    for (let n = 0; n < photos; n++)
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
          daysAgo + 1 + n,
          { reportId: reference },
        ),
      )
  }
  // One call whose provider gave no usage, to show the "no cost" notice.
  rows.push(
    row(wire({ usage_status: 'unavailable' }), 6, { reportId: 'RPT-2026-0003', section: '8' }),
  )
  // Knowledge-chat questions: one Cohere embed each, by engineer.
  for (const [email, questions] of [
    ['alex.rowe@example.com', 6],
    ['jide.okafor@example.com', 3],
  ] as const)
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
          { userId: userIds[email] },
        ),
      )
  // Straight to the collection: saving through the model would stamp every row "now".
  await AiCallModel.collection.insertMany(rows)
  return rows.length
}

// ---- Notifications --------------------------------------------------------

// A fixed id, so a re-run updates the same knowledge request instead of adding another.
const GAP_REQUEST_ID = new Types.ObjectId('5eed0000000000000000d001')

type Assessment = { id: string; reference: string; client: string; site: string; due?: string }

/**
 * Replaces the seed's notifications and writes one open knowledge request; returns how many
 * notifications it made. `byRef` holds each assessment as the Inbox rows show it.
 */
export async function seedNotifications(
  userIds: Record<string, Types.ObjectId>,
  byRef: Record<string, Assessment>,
): Promise<number> {
  await NotificationModel.deleteMany({ createdByService: SEED_SERVICE })
  const alex = String(userIds['alex.rowe@example.com'])
  const jide = String(userIds['jide.okafor@example.com'])
  const sana = userIds['sana.patel@example.com']
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000)
  const base = { readBy: [], dismissedBy: [], createdBy: sana, createdByService: SEED_SERVICE }
  const assigned = (a: Assessment, hours: number, to: string) => ({
    ...base,
    purpose: 'assessment_assigned' as const,
    message: `New assessment: ${a.site}`,
    targetRole: 'risk_engineer' as const,
    targetUserIds: [to],
    kind: 'inbox' as const,
    context: {
      reference: a.reference,
      assessmentId: a.id,
      client: a.client,
      site: a.site,
      sender: USERS.find((u) => u.role === 'knowledge_admin')!.name,
      ...(a.due && { reportDue: a.due }),
    },
    createdAt: ago(hours),
  })
  const drafted = (a: Assessment, section: string, hours: number) => ({
    ...base,
    createdBy: null,
    purpose: 'drafting_status' as const,
    message: `Your new draft of Section ${section} is ready.`,
    targetRole: 'risk_engineer' as const,
    targetUserIds: [alex],
    kind: 'bell' as const,
    context: {
      reference: a.reference,
      status: 'ready',
      client: a.client,
      site: a.site,
      ...(a.due && { reportDue: a.due }),
    },
    createdAt: ago(hours),
  })

  // The request an engineer sent to the knowledge admin, and the Inbox item it makes (CB-07).
  const question = 'Which standard covers sprinkler protection for blast freezers below -25 °C?'
  const note = 'Needed for the Tuas Cold Store resurvey.'
  await KnowledgeGapRequestModel.updateOne(
    { _id: GAP_REQUEST_ID },
    {
      $set: { question, message: note, askedBy: userIds['alex.rowe@example.com'], status: 'open' },
    },
    { upsert: true },
  )
  const notifications = [
    assigned(byRef['RPT-2026-0006'], 20, alex),
    assigned(byRef['RPT-2026-0007'], 18, jide),
    drafted(byRef['RPT-2026-0003'], '9', 30),
    drafted(byRef['RPT-2026-0003'], '7', 31),
    {
      ...base,
      createdBy: userIds['alex.rowe@example.com'],
      purpose: 'knowledge_gap_request' as const,
      message: 'New knowledge request',
      details: `${question}\n${note}`,
      targetRole: 'knowledge_admin' as const,
      targetUserIds: ['all'],
      kind: 'inbox' as const,
      context: {
        requestId: String(GAP_REQUEST_ID),
        question,
        askedBy: 'Alex Rowe',
        message: note,
      },
      createdAt: ago(5),
    },
  ]
  // Alex has already opened one older assignment, so his Inbox shows both To do and Done.
  const older = {
    ...assigned(byRef['RPT-2026-0005'], 24 * 6, alex),
    readBy: [alex],
  }
  await NotificationModel.insertMany([...notifications, older])
  return notifications.length + 1
}
