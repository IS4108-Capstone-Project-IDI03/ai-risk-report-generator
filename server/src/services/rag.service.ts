import { config } from '../config'
import { recordAiCalls } from './ai-usage.service'

// Stubs a call to the S4 RAG service. Real implementation will POST to
// `${config.ragServiceUrl}/generate`.
export async function generateReport(_body: unknown) {
  return { status: 'ok', ragServiceUrl: config.ragServiceUrl }
}

// Its message is the reason to show the engineer.
export class RagServiceError extends Error {
  constructor(message: string) {
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
    )
  }
  return body as T
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
  }
}

export async function requestSectionDraft(body: unknown): Promise<SectionDraftResult> {
  return callRag<SectionDraftResult>('/sections/draft', {
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

export async function requestSummaryDraft(body: unknown): Promise<SummaryDraftResult> {
  return callRag<SummaryDraftResult>('/summary/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
