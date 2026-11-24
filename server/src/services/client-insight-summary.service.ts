// The written summary on a client's Insights tab (CP-29): drafted by S4 from
// the engineer's own observations and the figures counted from them, with
// client details masked first (privacy.service, fail closed), and kept only
// once every statement was checked against its sources. Called by
// routes/client.routes.ts; calls client-insights.service and rag.service.
import { createHash } from 'crypto'
import { Types } from 'mongoose'
import {
  ClientInsightSummaryModel,
  type IClientInsightSummary,
  type IInsightSource,
} from '../models/client-insight-summary.model'
import { recordAiCalls } from './ai-usage.service'
import type { SessionUser } from './auth.service'
import { ClientSiteError } from './client.service'
import {
  INSIGHTS_RULES,
  readClientInsights,
  type ClientInsightsDto,
  type InsightEvidence,
} from './client-insights.service'
import { chatPrivacy } from './privacy.service'
import { RagServiceError, requestInsightSummary } from './rag.service'
import { hyphenated } from './speech.service'

export type InsightSummaryDto = {
  id: string
  statements: { text: string; citations: number[] }[]
  missing: string | null
  confidence: IClientInsightSummary['confidence']
  sources: {
    n: number
    kind: IInsightSource['kind']
    title: string
    meta: string | null
    quote: string
    observationId: string | null
    reference: string | null
  }[]
  basis: IClientInsightSummary['basis']
  writtenAt: Date
  // The observations or figures changed since it was written.
  outOfDate: boolean
}

export type ClientInsightsPage = ClientInsightsDto & {
  summary: InsightSummaryDto | null
  // Whether there is anything to write a summary from.
  canSummarise: boolean
}

// What the model was given, as one value: a different one means the evidence changed.
function fingerprintOf(evidence: InsightEvidence): string {
  return createHash('sha256')
    .update(JSON.stringify([evidence.figures, evidence.observations]))
    .digest('hex')
}

type Stored = IClientInsightSummary & { _id: Types.ObjectId }

function toDto(s: Stored, fingerprint: string): InsightSummaryDto {
  return {
    id: String(s._id),
    statements: s.statements.map((x) => ({ text: x.text, citations: x.citations })),
    missing: s.missing,
    confidence: s.confidence,
    sources: s.sources.map((x) => ({
      n: x.n,
      kind: x.kind,
      title: x.title,
      meta: x.meta ?? null,
      quote: x.quote,
      observationId: x.observationId ? String(x.observationId) : null,
      reference: x.reference ?? null,
    })),
    basis: s.basis,
    writtenAt: s.createdAt,
    outOfDate: s.fingerprint !== fingerprint,
  }
}

/**
 * Returns the client's insights with the signed-in user's latest summary, if
 * they have one. Throws ClientSiteError as readClientInsights does.
 */
export async function getClientInsights(
  id: string,
  user: SessionUser,
): Promise<ClientInsightsPage> {
  const { client, insights, evidence } = await readClientInsights(id, user)
  const latest = await ClientInsightSummaryModel.findOne({ client: client.id, userId: user.id })
    .sort({ createdAt: -1 })
    .lean<Stored>()
  return {
    ...insights,
    summary: latest ? toDto(latest, fingerprintOf(evidence)) : null,
    canSummarise: evidence.observations.length > 0,
  }
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayText = (day: string | null) =>
  day
    ? `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
    : null

// The sources the statements cite, numbered in the order they are first cited,
// each with its own words: an observation's as recorded, a figure's as counted.
function numbered(
  statements: { text: string; citations: string[] }[],
  evidence: InsightEvidence,
): { statements: IClientInsightSummary['statements']; sources: IInsightSource[] } {
  const numberOf = new Map<string, number>()
  const sources: IInsightSource[] = []
  for (const label of statements.flatMap((s) => s.citations)) {
    if (numberOf.has(label)) continue
    const observation = evidence.observations.find((o) => o.label === label)
    const figure = evidence.figures.find((f) => f.label === label)
    if (!observation && !figure) continue
    const n = sources.length + 1
    numberOf.set(label, n)
    sources.push(
      observation
        ? {
            n,
            kind: 'observation',
            title: [observation.site, observation.location].filter(Boolean).join(' · '),
            meta: [SEVERITY_LABEL[observation.severity], dayText(observation.date)]
              .filter(Boolean)
              .join(' · '),
            quote: observation.text,
            observationId: new Types.ObjectId(observation.observationId),
            reference: observation.reference,
          }
        : { n, kind: 'figure', title: figure!.title, meta: null, quote: figure!.lines.join(' ') },
    )
  }
  return {
    statements: statements
      .map((s) => ({
        text: s.text,
        citations: [...new Set(s.citations.flatMap((label) => numberOf.get(label) ?? []))],
      }))
      // S4 only returns cited statements; one whose labels match nothing here is not shown.
      .filter((s) => s.citations.length),
    sources,
  }
}

// One write at a time for each user and client: a second tap must not pay twice.
const writing = new Set<string>()

/**
 * Writes a new summary of the client's insights for the signed-in user and
 * returns it. Throws ClientSiteError (403, 404; 409 with nothing to write from
 * or one already being written) and RagServiceError, with the reason to show
 * (client details could not be masked, so nothing was sent; or the model or
 * its checks failed).
 */
export async function writeInsightSummary(
  id: string,
  user: SessionUser,
): Promise<InsightSummaryDto> {
  const { client, evidence } = await readClientInsights(id, user)
  if (!evidence.observations.length)
    throw new ClientSiteError('There are no observations to write a summary from yet.', 409)
  const key = `${client.id}:${user.id}`
  if (writing.has(key)) throw new ClientSiteError('The summary is already being written.', 409)
  writing.add(key)
  try {
    // Notes at one client can name another, so every client, site and person
    // is masked, as chat masks them (PV-03). Off: nothing is masked.
    const privacy = await chatPrivacy()
    const result = await requestInsightSummary({
      client: client.name,
      figures: evidence.figures,
      observations: evidence.observations.map((o) => ({
        label: o.label,
        site: o.site,
        location: o.location,
        severity: o.severity,
        categories: o.categories,
        date: o.date,
        text: o.text,
      })),
      privacy,
    })
    // F-12: a summary on the practice client is walkthrough usage, not client-insights.
    await recordAiCalls(hyphenated(result.usage), { userId: user.id, practice: client.practice })
    const { statements, sources } = numbered(result.statements, evidence)
    if (!statements.length)
      throw new RagServiceError(
        'The summary could not be checked against its sources, so nothing is shown. Write it again.',
        502,
      )
    const now = new Date()
    const saved = await ClientInsightSummaryModel.create({
      client: client.id,
      userId: user.id,
      statements,
      missing: result.missing,
      confidence: result.confidence,
      sources,
      basis: evidence.basis,
      fingerprint: fingerprintOf(evidence),
      provenance: {
        provider: result.provenance.provider,
        model: result.provenance.model,
        effort: result.provenance.effort,
        prompt_version: result.provenance.prompt_version,
        rules_version: INSIGHTS_RULES,
        generated_at: now,
        privacy: result.provenance.privacy,
      },
      metadata: {
        source_type: 'client_insight_summary',
        jurisdiction: null,
        facility_type: null,
        COPE_dimension: null,
        effective_date: now,
      },
    })
    return toDto(saved.toObject() as Stored, saved.fingerprint)
  } finally {
    writing.delete(key)
  }
}
