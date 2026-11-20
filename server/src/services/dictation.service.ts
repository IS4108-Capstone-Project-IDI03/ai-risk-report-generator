// Dictating into a text field of an assessment (CP-27): an observation note, a
// transcript correction, a comment, an Ask question or a checklist answer.
// Called by routes/dictation.routes.ts. The clip goes to S5 as bytes and is
// stored nowhere; S5 tidies the text, masking the assessment's client details
// before its tidy model reads it.
import { canOpenAssessment } from './assessment.service'
import { audioExtension } from './observation.service'
import { privacyFor } from './privacy.service'
import { SpeechServiceError, transcribeClip } from './speech.service'

// About two minutes of speech, as for a spoken chat question (chat-voice.service.ts).
// Must match the raw-body limit in routes/dictation.routes.ts.
export const MAX_DICTATION_BYTES = 2 * 1024 * 1024

// A refusal the route answers with its status and message.
export class DictationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DictationError'
  }
}

/** The tidy words in a short recording, for the user's assessment `reference`. */
export async function transcribeDictation(
  reference: string,
  user: { id: string; role: string },
  audio: Buffer,
  contentType: string,
): Promise<string> {
  const opens = await canOpenAssessment(reference, user)
  if (opens === null) throw new DictationError(404, 'There is no such assessment.')
  if (!opens) throw new DictationError(403, 'You cannot open this assessment.')

  const extension = audioExtension(contentType)
  if (!extension) throw new DictationError(415, 'That is not an audio recording.')
  if (!audio.length) throw new DictationError(400, 'The recording is empty.')
  if (audio.length > MAX_DICTATION_BYTES)
    throw new DictationError(413, 'That recording is too long. Dictate in shorter parts.')
  let text: string
  try {
    text = (await transcribeClip(audio, extension, await privacyFor(reference))).trim()
  } catch (error) {
    if (error instanceof SpeechServiceError) throw new DictationError(503, error.message)
    throw error
  }
  // Without this a silent clip would leave the field as it was with no word why.
  if (!text)
    throw new DictationError(422, 'No speech was heard. Try again closer to the microphone.')
  return text
}
