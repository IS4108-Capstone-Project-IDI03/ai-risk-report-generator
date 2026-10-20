import { config } from '../config'
import { recordAiCalls } from './ai-usage.service'

// Asks S5 to transcribe audio already stored in S3. S5 reads the file itself
// and returns the text; it stores nothing, so the caller saves the result.
// `reportId` (the assessment reference) tags the usage record (EV-03).
// Throws an Error whose message is the reason to show the engineer.
export async function transcribe(s3Key: string, reportId?: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${config.speechOcrServiceUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3_key: s3Key }),
    })
  } catch {
    throw new Error('The speech service could not be reached.')
  }
  const body = (await response.json().catch(() => ({}))) as {
    transcript?: string
    usage?: unknown
    detail?: unknown
  }
  if (!response.ok || typeof body.transcript !== 'string') {
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `The speech service failed with status ${response.status}.`,
    )
  }
  // S5 stores nothing, so the gateway records what Whisper used (EV-03).
  await recordAiCalls(body.usage, { reportId })
  return body.transcript
}

// A handwritten page as S5 transcribed it (CP-19).
export type HandwritingResult = {
  transcript: string
  // The words the model was unsure of, as [start, end) positions in `transcript`.
  uncertain: [number, number][]
  provider: string
  model: string
  promptVersion: string
}

// Asks S5 to transcribe a handwritten page already stored in S3, as transcribe
// does a recording: S5 stores nothing, the caller saves the result, and the
// gateway records what the call used (EV-03). Throws an Error whose message is
// the reason to show the engineer.
export async function transcribeHandwriting(
  s3Key: string,
  reportId?: string,
): Promise<HandwritingResult> {
  let response: Response
  try {
    response = await fetch(`${config.speechOcrServiceUrl}/transcribe-handwriting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s3_key: s3Key }),
    })
  } catch (error) {
    // Node's fetch gives up after five minutes without an answer; S5 was there,
    // just slow, so say so rather than that it could not be reached.
    const code = (error as { cause?: { code?: string } } | null)?.cause?.code
    throw new Error(
      code === 'UND_ERR_HEADERS_TIMEOUT'
        ? 'The handwriting service took too long to answer.'
        : 'The handwriting service could not be reached.',
      { cause: error },
    )
  }
  const body = (await response.json().catch(() => ({}))) as {
    transcript?: string
    uncertain?: unknown
    provider?: string
    model?: string
    prompt_version?: string
    usage?: unknown
    detail?: unknown
  }
  if (!response.ok || typeof body.transcript !== 'string') {
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `The handwriting service failed with status ${response.status}.`,
    )
  }
  await recordAiCalls(body.usage, { reportId })
  return {
    transcript: body.transcript,
    uncertain: Array.isArray(body.uncertain)
      ? body.uncertain.filter(
          (span): span is [number, number] =>
            Array.isArray(span) &&
            span.length === 2 &&
            span.every(Number.isInteger) &&
            0 <= span[0] &&
            span[0] < span[1] &&
            span[1] <= body.transcript!.length,
        )
      : [],
    provider: body.provider ?? 'unknown',
    model: body.model ?? 'unknown',
    promptVersion: body.prompt_version ?? 'unknown',
  }
}

// What S5 proposes from an observation's photos (CP-05).
export type InterpretationResult = {
  description: string
  cope_dimension: string
  hazard_type: string
  provider: string
  model: string
  prompt_version: string
  usage: {
    input_tokens: number
    output_tokens: number | null
    thought_tokens: number | null
  } | null
}

// Asks S5 to interpret photos already stored in S3, with where they were taken
// and the engineer's note. Like transcribe, S5 stores nothing and the caller
// saves the result. Throws an Error whose message is the reason to show.
export async function interpret(request: {
  s3Keys: string[]
  location: string | null
  note: string | null
}): Promise<InterpretationResult> {
  let response: Response
  try {
    response = await fetch(`${config.speechOcrServiceUrl}/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        s3_keys: request.s3Keys,
        location: request.location,
        note: request.note,
      }),
    })
  } catch {
    throw new Error('The photo service could not be reached.')
  }
  const body = (await response.json().catch(() => ({}))) as Partial<InterpretationResult> & {
    detail?: unknown
  }
  if (!response.ok || typeof body.description !== 'string') {
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `The photo service failed with status ${response.status}.`,
    )
  }
  return body as InterpretationResult
}
