// Test fakes for dictation (CP-27): a recorder, a microphone that hears speech, and a gateway that
// answers each dictation with `fakeMicrophone.reply()`. Call fakeMicrophoneEachTest() at the top
// of a test file; `dictate()` presses Dictate, lets it listen, then presses Stop.
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// A recorder that only remembers what it was told; stop() ends it like the real one.
class FakeRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  pause = () => void (this.state = 'paused')
  resume = () => void (this.state = 'recording')
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio']) })
    void this.onstop?.()
  }
}

export const DICTATED = 'The riser is not fire-stopped.'

export const fakeMicrophone = {
  // Every request the page made, in order.
  calls: [] as { url: string; init: RequestInit }[],
  // The gateway's answer to a dictation; anything else gets `other`.
  reply: (): Response => Response.json({ text: DICTATED }),
  other: (() => Response.json({})) as (url: string, init: RequestInit) => Response,
}

export function fakeMicrophoneEachTest() {
  beforeEach(() => {
    fakeMicrophone.calls = []
    fakeMicrophone.reply = () => Response.json({ text: DICTATED })
    fakeMicrophone.other = () => Response.json({})
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        resume = async () => {}
        createAnalyser = () => ({
          fftSize: 4,
          getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.1),
        })
        createMediaStreamSource = () => ({ connect: () => {} })
        close = async () => {}
      },
    )
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
          getAudioTracks: () => [{ label: 'Test Mic' }],
        }),
      },
    })
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      fakeMicrophone.calls.push({ url, init })
      return url.endsWith('/dictation') ? fakeMicrophone.reply() : fakeMicrophone.other(url, init)
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
}

/** Presses Dictate (the `nth` on the page), lets it hear speech, then presses Stop. */
export async function dictate(nth = 0) {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Dictate' }))[nth])
  // The level is read every 100 ms; wait for one reading, as a real recording would have.
  await act(() => new Promise((done) => setTimeout(done, 160)))
  fireEvent.click(await screen.findByRole('button', { name: 'Stop dictating' }))
}
