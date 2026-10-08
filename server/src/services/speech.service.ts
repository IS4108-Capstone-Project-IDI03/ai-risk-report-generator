import { config } from '../config'

// Asks S5 to transcribe audio already stored in S3. S5 reads the file itself
// and returns the text; it stores nothing, so the caller saves the result.
// Throws an Error whose message is the reason to show the engineer.
export async function transcribe(s3Key: string): Promise<string> {
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
    detail?: unknown
  }
  if (!response.ok || typeof body.transcript !== 'string') {
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `The speech service failed with status ${response.status}.`,
    )
  }
  return body.transcript
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
