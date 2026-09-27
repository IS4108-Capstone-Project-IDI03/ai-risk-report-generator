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
