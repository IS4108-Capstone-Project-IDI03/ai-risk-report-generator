import { config } from '../config'
import { recordAiCalls } from './ai-usage.service'
import { listIngestedDocuments } from './knowledge-document.service'

// Stubs a call to the S4 RAG service. Real implementation will POST to
// `${config.ragServiceUrl}/generate`.
export async function generateReport(_body: unknown) {
  return { status: 'ok', ragServiceUrl: config.ragServiceUrl }
}

// Its message is the reason to show the engineer.
export class RagServiceError extends Error {
  // `status` is S4's HTTP status when it answered; absent when it was unreachable.
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'RagServiceError'
  }
}

// ponytail: Node's fetch gives up waiting for response headers after 5 minutes.
// Stream the draft if a section takes longer than that to write.
async function callRag<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${config.ragServiceUrl}${path}`, init)
  } catch {
    throw new RagServiceError('The drafting service could not be reached.')
  }
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown }
  if (!response.ok) {
    throw new RagServiceError(
      typeof body.detail === 'string'
        ? body.detail
        : `The drafting service failed with status ${response.status}.`,
      response.status,
    )
  }
  return body as T
}

/**
 * Returns the chat body with `documents` built here, one {id, title, ...} per ingested
 * document (empty fields left out), so S4 can name each passage's document (CB-01).
 * Always replaces a `documents` the browser sent: without this, a user could put
 * invented names into the answer model's prompt.
 */
export async function withChatDocuments(body: unknown): Promise<object> {
  const documents = (await listIngestedDocuments()).map((d) => ({
    id: d.id,
    title: d.title,
    ...(d.issuingBody && { issuingBody: d.issuingBody }),
    ...(d.standardNumber && { standardNumber: d.standardNumber }),
    ...(d.edition && { edition: d.edition }),
  }))
  return { ...(body as object), documents }
}

/**
 * Returns one passage's text and page boxes from S4 for the citation panel (CB-02).
 * Throws RagServiceError; its `status` is 404 when S4 doesn't know the passage.
 */
export function getPassage(id: string): Promise<object> {
  return callRag(`/passages/${encodeURIComponent(id)}`)
}

// One passage as S4 gives it: its document, text, headings and pages.
export type FoundPassage = {
  id: string
  documentId: string | null
  text: string
  headings: string[]
  pageStart: number | null
  pageEnd: number | null
}

// The passage for a checklist item's reference (CP-32 AC2), or null when S4
// doesn't know it. Throws RagServiceError when S4 fails.
export async function findPassage(id: string): Promise<FoundPassage | null> {
  try {
    return await callRag<FoundPassage>(`/passages/${encodeURIComponent(id)}`)
  } catch (error: unknown) {
    if (error instanceof RagServiceError && error.status === 404) return null
    throw error
  }
}

// The documents' passages that best match the words, best first (CP-32 AC2):
// a keyword search in S4, with no paid call, so nothing is masked or recorded.
export async function searchPassages(
  query: string,
  documentIds: string[],
  limit = 10,
): Promise<FoundPassage[]> {
  const found = await callRag<{ results: FoundPassage[] }>('/passages/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, document_ids: documentIds, limit }),
  })
  return found.results
}

/**
 * S4's event stream for one chat request (CB-01), for the chat route to pass
 * on. Its final `usage` event is recorded for `userId` and removed (EV-03).
 */
export async function openChatStream(
  body: unknown,
  signal: AbortSignal,
  userId?: string,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response
  try {
    response = await fetch(`${config.ragServiceUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new RagServiceError('The chat service could not be reached.')
  }
  if (!response.ok || !response.body) {
    throw new RagServiceError(`The chat service failed with status ${response.status}.`)
  }
  return response.body.pipeThrough(recordingChatUsage(userId))
}

/**
 * S4's event stream for one question about an assessment (AS-01): its steps,
 * each checked statement, any missing evidence, then one `result` event. The
 * caller reads the result (usage, trace) before passing anything on.
 */
export async function openAskStream(
  body: unknown,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response
  try {
    response = await fetch(`${config.ragServiceUrl}/assessments/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new RagServiceError('the answer service could not be reached')
  }
  if (!response.ok || !response.body) {
    throw new RagServiceError(
      `the answer service failed with status ${response.status}`,
      response.status,
    )
  }
  return response.body
}

// The AG-UI event S4 ends a chat answer with: the answer's paid calls.
const isUsageEvent = (block: string) => {
  if (!block.startsWith('data: ')) return null
  try {
    const event = JSON.parse(block.slice(6))
    return event?.type === 'CUSTOM' && event.name === 'usage' ? event : null
  } catch {
    return null
  }
}

// Passes every server-sent event through unchanged except S4's usage event,
// which is saved as `chat` calls for the user and not sent on: it is
// bookkeeping, not part of the answer. Events are split on the blank line that
// ends each one, so an event cut across network chunks is still found.
function recordingChatUsage(userId?: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  return new TransformStream({
    async transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      let end: number
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const block = pending.slice(0, end + 2)
        pending = pending.slice(end + 2)
        const usage = isUsageEvent(block)
        if (!usage) {
          controller.enqueue(encoder.encode(block))
          continue
        }
        const calls = Array.isArray(usage.value) ? usage.value : []
        await recordAiCalls(
          calls.map((call: object) => ({ ...call, feature: 'chat' })),
          { userId },
        )
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending) controller.enqueue(encoder.encode(pending))
    },
  })
}

// The report template's sections 7-12 and what each needs, as S4 holds them.
export type TemplateSection = {
  id: string
  title: string
  cope_dimensions: string[]
  min_observations: number
}

export async function listTemplateSections(): Promise<TemplateSection[]> {
  return (await callRag<{ sections: TemplateSection[] }>('/sections')).sections
}

// Whether client details were masked before the draft's external AI calls, and
// how many distinct ones (PV-02). Never the details themselves.
export type DraftPrivacy = { enabled: boolean; masked_count: number }

// What S4 sends back for one drafted section (see rag-service POST /sections/draft).
export type SectionDraftResult = {
  section_id: string
  title: string
  subsections: {
    heading: string
    kind: 'narrative' | 'fields' | 'table'
    statements: { text: string; citations: string[]; supported: boolean }[]
  }[]
  sources: Record<string, unknown>
  questions: string[]
  guardrail: { passed: boolean; unsupported_count: number }
  // One item per paid call that made the draft (EV-03); saved by section.service.ts.
  usage?: unknown
  provenance: {
    provider: string
    model: string
    effort: string
    prompt_version: string
    template_version: string
    generated_at: string
    // What the engineer asked a regenerated draft to change (RV-02), or null.
    instruction?: string | null
    privacy?: DraftPrivacy
  }
}

export async function requestSectionDraft(body: unknown): Promise<SectionDraftResult> {
  return callRag<SectionDraftResult>('/sections/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// What S4 sends back for a pre-survey checklist (see rag-service POST
// /checklist/draft, CP-30).
export type ChecklistDraftResult = {
  items: {
    area: string
    subsection: string | null
    origin: 'template' | 'standard' | 'hazard' | 'hazard_list'
    hazard: string | null
    text: string
    fields: string[]
    COPE_dimension: string[]
    citations: { ref: string; quote: string; quote_found: boolean }[]
    flags: 'uncited'[]
  }[]
  areas: { id: string; title: string }[]
  hazards: { id: string; name: string; standards: string[]; in_scope: string[] }[]
  sources: Record<string, unknown>
  // One item per paid call (EV-03); saved by checklist.service.ts.
  usage?: unknown
  provenance: {
    provider: string
    model: string | null
    effort: string
    prompt_version: string
    checklist_version: string
    template_version: string
    generated_at: string
  }
}

export async function requestChecklistDraft(body: unknown): Promise<ChecklistDraftResult> {
  return callRag<ChecklistDraftResult>('/checklist/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// What S4 sends back for drafted OFIs (see rag-service POST /ofis/draft, GN-05).
export type OfiDraftResult = {
  ofis: {
    title: string
    category: string
    type: string
    description: string
    observation: string
    likelihood: string
    consequence: string
    priority: string
    effort: string
    observations: string[]
    standards: string[]
    precedent: string | null
  }[]
  sources: Record<string, unknown>
  provenance: {
    provider: string
    model: string | null
    effort: string
    prompt_version: string
    config_version: string
    generated_at: string
    privacy?: DraftPrivacy
  }
  // Paid calls for the cost report (EV-03), as for a section draft.
  usage?: unknown
}

export async function requestOfiDraft(body: unknown): Promise<OfiDraftResult> {
  return callRag<OfiDraftResult>('/ofis/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// What S4 sends back for Section 2's Executive Summary (see rag-service POST
// /summary/draft, GN-07): its statements, each citing sections as `S:<id>`.
export type SummaryDraftResult = {
  statements: { text: string; citations: string[]; supported: boolean }[]
  guardrail: SectionDraftResult['guardrail']
  usage?: unknown
  provenance: SectionDraftResult['provenance']
}

// What S4 proposes for Section 4 or 5's figures (rag-service POST /figures/propose,
// GN-03 addendum): Section 4's `categories` or Section 5's `levels`, each figure with a
// reason and its citations (`O:<id>`, `S:<id>`), or null where out of range.
export type FigureProposalResult = {
  proposal: { categories?: unknown[]; levels?: ProposedLevel[] }
  usage?: unknown
  provenance: Omit<SectionDraftResult['provenance'], 'template_version'>
}
export type ProposedLevel = {
  level: string
  damage: { item: string; percent: number | null; reason: string; citations: string[] }[]
  te: {
    item: string
    months: number | null
    percent: number | null
    reason: string
    citations: string[]
  }[]
}

export async function requestFigureProposal(body: unknown): Promise<FigureProposalResult> {
  return callRag<FigureProposalResult>('/figures/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function requestSummaryDraft(body: unknown): Promise<SummaryDraftResult> {
  return callRag<SummaryDraftResult>('/summary/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// What the gateway sends rag-service to read a site walk (CP-22), in camelCase;
// proposeSiteWalk turns it into the snake_case body of POST /site-walks/propose
// and the answer back. Recordings and notes must already be sorted by seq.
export type SiteWalkProposeInput = {
  reportId: string
  transcript:
    | {
        kind: 'recordings'
        // Recordings and typed notes together, sorted by seq.
        recordings: (
          | {
              seq: number
              durationSec: number
              segments: { start: number; end: number; text: string }[]
            }
          | { seq: number; kind: 'typed'; text: string }
        )[]
      }
    | { kind: 'typed'; text: string }
  existingLocations: { id: string; building: string | null; floor: string | null; name: string }[]
  photos: {
    id: string
    recordingSeq: number | null
    offsetSec: number | null
    description: string
  }[]
  siteName: string | null
  privacy: { enabled: boolean; known_entities: unknown[] }
}

/** Asks rag-service for a site walk proposal; returns it in camelCase, unchecked. */
export async function proposeSiteWalk(
  input: SiteWalkProposeInput,
): Promise<{ proposal: unknown; usage: unknown }> {
  const body = await callRag<{
    locations?: Record<string, unknown>[]
    observations?: Record<string, unknown>[]
    usage?: unknown
  }>('/site-walks/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      report_id: input.reportId,
      transcript:
        input.transcript.kind === 'recordings'
          ? {
              kind: 'recordings',
              recordings: input.transcript.recordings.map((r) =>
                'kind' in r ? r : { seq: r.seq, duration_sec: r.durationSec, segments: r.segments },
              ),
            }
          : input.transcript,
      existing_locations: input.existingLocations,
      photos: input.photos.map((p) => ({
        id: p.id,
        recording_seq: p.recordingSeq,
        offset_sec: p.offsetSec,
        description: p.description,
      })),
      site_name: input.siteName,
      privacy: input.privacy,
    }),
  })
  const proposal = {
    locations: (body.locations ?? []).map((l) => ({
      ref: l.ref,
      existingId: l.existing_id ?? null,
      kind: l.kind,
      building: l.building ?? null,
      floor: l.floor ?? null,
      name: l.name,
    })),
    observations: (body.observations ?? []).map((o) => ({
      ref: o.ref,
      note: o.note,
      copeDimension: o.cope_dimension ?? null,
      severity: o.severity ?? null,
      locationRef: o.location_ref ?? null,
      recordingSeq: o.recording_seq ?? null,
      start: o.start ?? null,
      end: o.end ?? null,
      photoIds: o.photo_ids ?? [],
      check: o.check,
    })),
  }
  return { proposal, usage: body.usage }
}

// What the gateway sends rag-service to read a client's documents (CP-23), in
// the snake_case of POST /client-intakes/read. Must match ReadClientIntakeRequest
// in microservices/rag-service/app/api/routes.py, which refuses unknown fields.
export type ClientIntakeReadBody = {
  documents: { id: string; name: string; text: string }[]
  clients: {
    id: string
    name: string
    division: string | null
    sites: { id: string; name: string; address: string | null; has_assessments: boolean }[]
  }[]
  facility_types: string[]
  jurisdictions: { code: string; name: string }[]
  privacy: { enabled: boolean; known_entities: unknown[]; detect?: ('CLIENT' | 'SITE')[] }
}

// A snake_case key in camelCase, e.g. existing_id -> existingId.
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/** Returns the value with every object key in camelCase, at any depth. */
function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelKeys(v)]))
}

/**
 * Asks rag-service to read a client's documents (CP-23). Returns its proposal
 * in camelCase, unchecked, and its usage list. Throws RagServiceError; its
 * `status` is 503 when privacy protection is on and masking is unavailable.
 */
export async function readClientIntake(
  body: ClientIntakeReadBody,
): Promise<{ result: Record<string, unknown>; usage: unknown }> {
  const { usage, ...result } = await callRag<Record<string, unknown>>('/client-intakes/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { result: camelKeys(result) as Record<string, unknown>, usage }
}
