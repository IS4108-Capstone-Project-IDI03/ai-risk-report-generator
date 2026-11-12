// Gateway calls for the review workspace's Ask tab (AS-01):
// GET and POST /api/assessments/:reference/ask (server/src/routes/ask.routes.ts).
// A question is one POST whose answer streams back as server-sent events; the
// tab never polls, so the idle sign-out (F-07) still applies.
import { GatewayError, reportSessionEnded, request } from '../api'
import type { FieldObservation, SourcePassage } from '../api'
import { passageBody, type AskPassage } from './passage'

export type AskCitation = {
  // `O:<observation id>`, `C:<chunk id>` (a standard) or `P:<chunk id>` (a past report).
  ref: string
  kind: 'observation' | 'standard' | 'report'
  quote: string | null
  // Whether the quoted words were found in the source.
  verified: boolean
}
export type AskStatement = {
  text: string
  citations: AskCitation[]
  // Names where the sources behind a selected passage disagree (AS-02 AC4).
  differs?: boolean
}
export type Confidence = 'high' | 'medium' | 'low'
export type AskFailure = { step: string; cause: string; at: string }

export type AskAnswer = {
  id: string
  question: string
  // The passage selected in the draft that it is about (AS-02), or null.
  passage: AskPassage | null
  askedAt: string
  status: 'answering' | 'complete' | 'stopped' | 'failed'
  statements: AskStatement[]
  missing: string[]
  passages: SourcePassage[]
  observations: FieldObservation[]
  confidence: Confidence | null
  error: AskFailure | null
}

// What a question is searched in (AC3), as the tab states it.
export type AskScope = {
  observations: number
  standards: { id: string; name: string }[]
  standardsFrom: 'checklist' | 'applicable'
  jurisdiction: string
  facilityType: string
  pastReports: number
}

export type AskList = { scope: AskScope | null; questions: AskAnswer[] }

export async function listQuestions(reference: string, signal?: AbortSignal): Promise<AskList> {
  const { data } = await request<Partial<AskList>>(
    'GET',
    `/api/assessments/${encodeURIComponent(reference)}/ask`,
    undefined,
    signal,
  )
  // Only a list from the gateway counts; anything else reads as no questions yet.
  return {
    scope: data && typeof data === 'object' && 'scope' in data ? (data.scope ?? null) : null,
    questions: Array.isArray(data?.questions) ? data.questions : [],
  }
}

// One event of an answer's stream, as the gateway sends it.
export type AskEvent =
  | { type: 'question'; id: string; question: string; askedAt: string }
  | { type: 'step'; step: 'retrieve' | 'generate' | string }
  // A statement with the sources it cites, so a citation opens before the answer ends.
  | ({
      type: 'statement'
      passages?: SourcePassage[]
      observations?: FieldObservation[]
    } & AskStatement)
  | { type: 'missing'; text: string }
  | { type: 'result'; answer: AskAnswer }

// A question refused before it was answered (429 over the limits), with its
// cause, time and next step (AC8).
export class AskRefusedError extends Error {
  readonly reason: string
  readonly at: string
  readonly next: string
  constructor(reason: string, at: string, next: string) {
    super(reason)
    this.name = 'AskRefusedError'
    this.reason = reason
    this.at = at
    this.next = next
  }
}

/**
 * Asks one question, about a selected passage when given (AS-02); `onEvent`
 * gets each event as it arrives. Resolves when the stream ends.
 */
export async function askQuestion(
  reference: string,
  question: string,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
  passage?: AskPassage | null,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/assessments/${encodeURIComponent(reference)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passage ? { question, passage: passageBody(passage) } : { question }),
      signal,
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw error
    throw new GatewayError(null)
  }
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (response.status === 401) reportSessionEnded()
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      error?: string
      cause?: string
      next?: string
      at?: string
      fields?: Record<string, string>
    }
    if (problem.cause && problem.at)
      throw new AskRefusedError(problem.cause, problem.at, problem.next ?? 'Ask again.')
    throw new GatewayError(response.status, problem.error, problem.fields, problem)
  }
  if (!response.body) throw new GatewayError(response.status)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const flush = (final: boolean) => {
    const blocks = pending.split('\n\n')
    pending = final ? '' : (blocks.pop() ?? '')
    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        onEvent(JSON.parse(data) as AskEvent)
      } catch {
        // Not an event the tab knows; it is skipped.
      }
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    flush(false)
  }
  pending += decoder.decode()
  flush(true)
}
