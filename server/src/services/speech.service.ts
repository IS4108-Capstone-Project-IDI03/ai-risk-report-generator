import { config } from '../config'
import { recordAiCalls } from './ai-usage.service'
import type { ReadingPrivacy } from './privacy.service'

// A speech-service failure. `retryable` is true when trying again can work: the
// service could not be reached, timed out, or was busy or rate-limited (408,
// 429, 5xx). The transcription queue retries these instead of failing the
// recording (CP-22). Its message is the reason to show the engineer.
export class SpeechServiceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'SpeechServiceError'
  }
}

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500

// The short reason shown for a failed recording, from the saved error text (the
// prefixes are S5's, microservices/speech-ocr-service/app/processors/stt.py).
// The engineer's side first (what to change), then the service's ("try again").
// Used for voice notes (observation.service.ts) and site walks (site-walk.service.ts).
export function transcriptionFailureReason(error?: string): string | null {
  if (!error) return null
  if (error.startsWith('The recording could not be read from storage:')) {
    return /SSL|certificate/i.test(error)
      ? 'Could not securely connect to audio storage.'
      : 'The recording could not be read from storage.'
  }
  if (/Error code: 413|content size|too large|too long|maximum/i.test(error))
    return 'The recording is too long or too large. Record it in shorter parts.'
  if (/Error code: 415|invalid file format|unsupported|corrupt|decode/i.test(error))
    return 'The recording format is not supported. Record it again.'
  if (/too short|no speech|silen/i.test(error)) return 'No speech was heard in the recording.'
  if (/unclear|unintelligible/i.test(error))
    return 'The audio was too unclear to transcribe. Record it again closer to the speaker.'
  if (/Error code: 429|status 429|rate limit|quota/i.test(error))
    return 'The speech service has reached its usage limit. Try again later.'
  if (/timed? ?out|status 408/i.test(error))
    return 'The speech service took too long to answer. Try again later.'
  if (/could not be reached/i.test(error))
    return 'The speech service could not be reached. Try again later.'
  if (/Error code: 50\d|status 50\d|high demand|overloaded|busy/i.test(error))
    return 'The speech service is busy. Try again later.'
  if (error.startsWith('Whisper could not transcribe the recording:'))
    return 'The speech service could not transcribe the recording.'
  return error.length > 200 ? 'Transcription failed. Please retry or contact support.' : error
}

export type Segment = { start: number; end: number; text: string }

// POSTs JSON to S5 and returns its JSON, or throws a SpeechServiceError.
async function callS5<T extends object>(
  path: string,
  payload: object,
  unreachable: string,
  isAnswer: (body: Partial<T>) => boolean,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${config.speechOcrServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new SpeechServiceError(unreachable, true)
  }
  const body = (await response.json().catch(() => ({}))) as Partial<T> & { detail?: unknown }
  if (!response.ok || !isAnswer(body)) {
    throw new SpeechServiceError(
      typeof body.detail === 'string'
        ? body.detail
        : `The speech service failed with status ${response.status}.`,
      retryableStatus(response.status),
    )
  }
  return body as T
}

// Asks S5 to transcribe audio already stored in S3. S5 reads the file itself
// and returns the text with Whisper's timed segments; it stores nothing, so the
// caller saves the result. `reportId`
// (the assessment reference) tags the usage record (EV-03).
// Throws a SpeechServiceError whose message is the reason to show the engineer.
export async function transcribeWithSegments(
  s3Key: string,
  options: { reportId?: string } = {},
): Promise<{ transcript: string; segments: Segment[] }> {
  const body = await callS5<{ transcript: string; segments?: unknown; usage?: unknown }>(
    '/transcribe',
    { s3_key: s3Key },
    'The speech service could not be reached.',
    (b) => typeof b.transcript === 'string',
  )
  // S5 stores nothing, so the gateway records what Whisper used (EV-03).
  await recordAiCalls(body.usage, { reportId: options.reportId })
  const segments = Array.isArray(body.segments)
    ? body.segments.filter(
        (g): g is Segment =>
          !!g &&
          typeof g.start === 'number' &&
          typeof g.end === 'number' &&
          typeof g.text === 'string',
      )
    : []
  return { transcript: body.transcript, segments }
}

// Asks S5 to transcribe a short clip sent as bytes: no S3 round trip, so a spoken chat question
// (CB-10) comes back sooner and is stored nowhere. `extension` tells Whisper the format.
export async function transcribeClip(audio: Buffer, extension: string): Promise<string> {
  const body = await callS5<{ transcript: string; usage?: unknown }>(
    '/transcribe-clip',
    { audio_base64: audio.toString('base64'), filename: `question.${extension}` },
    'The speech service could not be reached.',
    (b) => typeof b.transcript === 'string',
  )
  await recordAiCalls(body.usage)
  return body.transcript
}

// The text alone, for a voice note.
export async function transcribe(s3Key: string, reportId?: string): Promise<string> {
  return (await transcribeWithSegments(s3Key, { reportId })).transcript
}

// Asks S5 for one or two plain sentences on what a site photo shows (CP-22).
// Only the photo is sent. S5 reports its usage as describe_photo; the gateway
// spells features with a hyphen.
export async function describePhoto(s3Key: string, reportId?: string): Promise<string> {
  const body = await callS5<{ description: string; usage?: unknown }>(
    '/describe-photo',
    { s3_key: s3Key },
    'The photo service could not be reached.',
    (b) => typeof b.description === 'string',
  )
  await recordAiCalls(hyphenated(body.usage), { reportId })
  return body.description
}

// How many faces a stored chat photo has, and a base64 copy with them blurred (null when none)
// (CB-08). S5 stores nothing. Throws a SpeechServiceError.
export async function checkChatPhotoFaces(
  s3Key: string,
): Promise<{ faces: number; blurred: Buffer | null }> {
  const body = await callS5<{ faces: number; blurred_base64: string | null }>(
    '/chat-photo/faces',
    { s3_key: s3Key },
    'The photo service could not be reached.',
    (b) => typeof b.faces === 'number',
  )
  return {
    faces: body.faces,
    blurred: body.blurred_base64 ? Buffer.from(body.blurred_base64, 'base64') : null,
  }
}

// What a stored chat photo shows and what could not be made out (CB-08). Only the photo goes to
// the vision model. S5 reports its usage as describe_photo; the gateway spells features with a hyphen.
export async function describeChatPhoto(
  s3Key: string,
): Promise<{ description: string; unclear: string }> {
  const body = await callS5<{ description: string; unclear?: string; usage?: unknown }>(
    '/chat-photo/describe',
    { s3_key: s3Key },
    'The photo service could not be reached.',
    (b) => typeof b.description === 'string',
  )
  await recordAiCalls(hyphenated(body.usage))
  return { description: body.description, unclear: body.unclear ?? '' }
}

// The text of each page of a PDF attached to a chat (CB-09). S5 stores nothing. A file it refuses
// (scanned, protected, too long) is a SpeechServiceError that is not retryable, with the reason.
export async function extractChatPdf(
  pdf: Buffer,
): Promise<{ pages: { page: number; text: string }[]; skipped: number[] }> {
  return callS5<{ pages: { page: number; text: string }[]; skipped: number[] }>(
    '/chat-pdf/extract',
    { pdf_base64: pdf.toString('base64') },
    'The PDF service could not be reached.',
    (b) => Array.isArray(b.pages),
  )
}

// Usage items with `_` in their feature turned into `-`, the gateway's spelling.
export function hyphenated(usage: unknown): unknown {
  if (!Array.isArray(usage)) return usage
  return usage.map((u) =>
    u && typeof u.feature === 'string' ? { ...u, feature: u.feature.replaceAll('_', '-') } : u,
  )
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

// What S5 proposes from an observation (CP-05, CP-21): categories from
// everything given, and from photos a description and hazard type; null for a
// part not asked for.
export type InterpretationResult = {
  categories:
    | {
        category: string
        reason: string
        evidence: { item: string; quote: string | null }[]
      }[]
    | null
  description: string | null
  hazard_type: string | null
  provider: string
  model: string
  prompt_version: string
  usage: {
    input_tokens: number
    output_tokens: number | null
    thought_tokens: number | null
  } | null
  // What S5 protected before the model saw the reading (PV-04).
  privacy?: {
    enabled: boolean
    masked_count: number
    faces_blurred: number
    removed_from_answer: number
  }
  // With protection on, each photo as the model saw it (base64 JPEG), by label.
  redacted_photos?: { label: string; faces: number; image: string }[]
}

// Asks S5 to read an observation: its photos already stored in S3 and its
// texts (note and transcripts), each under the label the proposal cites it by,
// with where it was found, for the parts asked for (CP-21). Like transcribe,
// S5 stores nothing and the caller saves the result. `privacy` says whether S5
// masks the text and blurs faces before the model sees them (PV-04). Throws an
// Error whose message is the reason to show.
export async function interpret(request: {
  photos: { label: string; s3Key: string }[]
  texts: { label: string; kind: 'note' | 'recording' | 'page'; text: string }[]
  location: string | null
  parts: ('categories' | 'description')[]
  privacy: ReadingPrivacy
}): Promise<InterpretationResult> {
  let response: Response
  try {
    response = await fetch(`${config.speechOcrServiceUrl}/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: request.photos.map((p) => ({ label: p.label, s3_key: p.s3Key })),
        texts: request.texts,
        location: request.location,
        parts: request.parts,
        privacy: request.privacy,
      }),
    })
  } catch {
    throw new Error('The AI service could not be reached.')
  }
  const body = (await response.json().catch(() => ({}))) as Partial<InterpretationResult> & {
    detail?: unknown
  }
  const answered =
    (!request.parts.includes('categories') || Array.isArray(body.categories)) &&
    (!request.parts.includes('description') || typeof body.description === 'string')
  if (!response.ok || !answered) {
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `The AI service failed with status ${response.status}.`,
    )
  }
  return body as InterpretationResult
}
