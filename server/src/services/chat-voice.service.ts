// A spoken chat question turned into text (CB-10). Called by routes/chat.routes.ts.
// Calls storage.service.ts (S3) and speech.service.ts (S5 Whisper).
import { randomUUID } from 'node:crypto'
import { ChatError } from './chat-error'
import { audioExtension } from './observation.service'
import { SpeechServiceError, transcribe } from './speech.service'
import { deleteObject, putObject } from './storage.service'

// About two minutes of speech; a question is a few seconds. Must match the raw-body limit in routes/chat.routes.ts.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024

/** Returns the words in a short recording; the audio is kept in S3 only while S5 reads it. */
export async function transcribeQuestion(audio: Buffer, contentType: string): Promise<string> {
  const extension = audioExtension(contentType)
  if (!extension) throw new ChatError(415, 'That is not an audio recording.')
  if (!audio.length) throw new ChatError(400, 'The recording is empty.')
  if (audio.length > MAX_AUDIO_BYTES)
    throw new ChatError(413, 'That recording is too long. Ask in a shorter clip.')

  const key = `chat-voice/${randomUUID()}.${extension}`
  await putObject(key, audio, contentType)
  try {
    const text = (await transcribe(key)).trim()
    // Without this a silent clip would put an empty question in the box.
    if (!text) throw new ChatError(422, 'No speech was heard. Try again closer to the microphone.')
    return text
  } catch (error) {
    if (error instanceof SpeechServiceError) throw new ChatError(503, error.message)
    throw error
  } finally {
    // Without this, every question would leave a recording in storage.
    await deleteObject(key).catch(() => {})
  }
}
