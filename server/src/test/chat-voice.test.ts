// A spoken chat question (CB-10): S5's failures reach the engineer as a short reason, never
// Whisper's raw error text. S5 is a stubbed fetch, so no paid call is made.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeQuestion } from '../services/chat-voice.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()
afterEach(() => vi.unstubAllGlobals())

const s5Says = (reply: object, status: number) =>
  vi.stubGlobal('fetch', async () => Response.json(reply, { status }))
const clip = Buffer.from('OggS fake clip')

describe('transcribeQuestion', () => {
  it('answers 422 with a short reason when Whisper refuses the clip', async () => {
    s5Says(
      {
        detail:
          "Whisper could not transcribe the recording: Error code: 400 - {'error': {'message': 'Invalid file format.'}}",
      },
      422,
    )

    await expect(transcribeQuestion(clip, 'audio/ogg')).rejects.toMatchObject({
      status: 422,
      message: 'The recording format is not supported. Record it again.',
    })
  })

  it('answers 503 when the speech service is busy', async () => {
    s5Says({ detail: 'The speech service is busy.' }, 503)

    await expect(transcribeQuestion(clip, 'audio/ogg')).rejects.toMatchObject({ status: 503 })
  })
})
