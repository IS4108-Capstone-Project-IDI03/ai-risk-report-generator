import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { VoiceObservation } from './api'

const REF = 'RPT-2026-0411'
const CAPTURE_URL = `/api/assessments/${REF}/capture-session`
const OBS_URL = `/api/assessments/${REF}/observations`
const CAPTURE = {
  session: { id: 's1', status: 'active', startedAt: '2026-09-26T08:00:00.000Z' },
  assessment: {
    id: 'a1',
    reference: REF,
    client: 'Northgate Logistics',
    site: { code: 'SITE-0001', name: 'Tilbury Distribution Centre' },
  },
}
function voiceNote(
  id: string,
  transcription: Partial<VoiceObservation['transcription']>,
): VoiceObservation {
  return {
    id,
    type: 'voice',
    engineer: 'A. Rowe',
    recordedAt: '2026-09-26T08:05:00.000Z',
    copeDimension: 'Protection',
    standard: null,
    severity: 'high',
    area: 'Bay 3 — north aisle',
    audio: { contentType: 'audio/webm', size: 1200, url: `/api/observations/${id}/audio` },
    transcription: {
      status: 'transcribing',
      transcript: null,
      error: null,
      attempts: 1,
      ...transcription,
    },
  }
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

// A small stand-in for the gateway, answering by route. The dashboard list is
// unreachable, so the app falls back to its sample rows.
let saved: VoiceObservation[] = []
let uploadReply: () => Promise<Response>
const posts: { url: string; init: RequestInit }[] = []
function mockGateway() {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') posts.push({ url, init })
    if (url === CAPTURE_URL) return json(201, CAPTURE)
    if (url === OBS_URL) return json(200, saved)
    if (url.startsWith(OBS_URL + '/voice')) return uploadReply()
    if (url.endsWith('/transcription/retry')) return json(202, saved[0])
    return Promise.reject(new TypeError('Failed to fetch'))
  })
}

// jsdom has no microphone: getUserMedia and MediaRecorder are stubbed.
const stopTrack = vi.fn()
function allowMicrophone() {
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: stopTrack }] }),
    },
  })
  vi.stubGlobal(
    'MediaRecorder',
    class {
      mimeType = 'audio/webm'
      ondataavailable: (event: { data: Blob }) => void = () => {}
      onstop: () => void = () => {}
      start() {}
      stop() {
        this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/webm' }) })
        this.onstop()
      }
    },
  )
}

function signIn() {
  render(<App />)
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}
async function openVoiceCapture() {
  signIn()
  fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
  await screen.findByText('Capture session started')
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }))
}

beforeAll(() => {
  // jsdom cannot play blobs; the list only needs a URL to hand the player.
  URL.createObjectURL = () => 'blob:clip'
  URL.revokeObjectURL = () => {}
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  saved = []
  posts.length = 0
  stopTrack.mockReset()
  uploadReply = () => {
    const note = voiceNote('o1', {})
    saved = [note]
    return json(201, note)
  }
  mockGateway()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Voice capture (CP-03)', () => {
  it('records a voice note, saves the audio, and shows it transcribing', async () => {
    allowMicrophone()
    await openVoiceCapture()

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))

    // Stopping lists the recording and resets the clock; nothing is uploaded yet.
    const list = await screen.findByRole('region', { name: 'Recordings to save' })
    expect(within(list).getByText('Recording 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record another' })).toBeInTheDocument()
    expect(posts.some((p) => p.url.startsWith(OBS_URL + '/voice'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(await screen.findByText(/Voice note saved to RPT-2026-0411/)).toBeInTheDocument()
    const upload = posts.find((p) => p.url.startsWith(OBS_URL + '/voice'))!
    expect(upload.init.body).toBeInstanceOf(Blob)
    expect(new Headers(upload.init.headers).get('X-Engineer')).toBe('A. Rowe')
    expect(new Headers(upload.init.headers).get('Content-Type')).toBe('audio/webm')
    // The form's default category, Fire protection, is filed as Protection.
    expect(new Headers(upload.init.headers).get('X-COPE-Dimension')).toBe('Protection')
    expect(new Headers(upload.init.headers).get('X-Severity')).toBe('high')
    // The form's default location is sent; no standard is picked by default.
    const query = new URL(upload.url, 'http://x').searchParams
    expect(query.get('area')).toBe('Bay 3 — north aisle')
    expect(query.has('standard')).toBe(false)
    expect(stopTrack).toHaveBeenCalled()
    expect(await screen.findByText('Transcribing')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recordings to save' })).not.toBeInTheDocument()
  })

  it('lists several recordings and saves each as its own voice note', async () => {
    allowMicrophone()
    await openVoiceCapture()
    for (const label of ['Start recording', 'Record another', 'Record another']) {
      fireEvent.click(await screen.findByRole('button', { name: label }))
      fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    }
    const list = await screen.findByRole('region', { name: 'Recordings to save' })
    expect(within(list).getAllByText(/^Recording \d$/)).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Recording 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(await screen.findByText(/2 voice notes saved/)).toBeInTheDocument()
    expect(posts.filter((p) => p.url.startsWith(OBS_URL + '/voice'))).toHaveLength(2)
  })

  it('uploads an audio file instead of recording', async () => {
    allowMicrophone()
    await openVoiceCapture()

    fireEvent.change(screen.getByLabelText(/Standard reference/), {
      target: { value: 'NFPA 25 – 2026 Edition' },
    })
    const file = new File(['audio'], 'bay3.m4a', { type: 'audio/x-m4a' })
    fireEvent.change(screen.getByLabelText('Upload audio files'), { target: { files: [file] } })
    expect(screen.getByText('bay3.m4a')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(await screen.findByText(/Voice note saved/)).toBeInTheDocument()
    const upload = posts.find((p) => p.url.startsWith(OBS_URL + '/voice'))!
    expect(upload.init.body).toBe(file)
    expect(new URL(upload.url, 'http://x').searchParams.get('standard')).toBe(
      'NFPA 25 – 2026 Edition',
    )
  })

  it('explains a blocked microphone and offers upload instead', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      },
    })
    await openVoiceCapture()

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Microphone access is blocked. Allow it in your browser's site settings, or upload a recording instead.",
    )
  })

  it('keeps a recording that failed to upload and sends it again', async () => {
    allowMicrophone()
    uploadReply = () => Promise.reject(new TypeError('Failed to fetch'))
    await openVoiceCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Recording not saved')
    uploadReply = () => json(201, voiceNote('o1', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))

    expect(await screen.findByText(/Voice note saved/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(posts.filter((p) => p.url.startsWith(OBS_URL + '/voice'))).toHaveLength(2)
  })
})

describe('Voice notes on the Observations tab (CP-03)', () => {
  async function openObservations() {
    signIn()
    fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
  }

  it('shows the failure reason when opened and retries the same recording', async () => {
    saved = [voiceNote('o9', { status: 'failed', error: 'Whisper timed out.', attempts: 1 })]
    await openObservations()

    fireEvent.click(await screen.findByRole('button', { name: /Transcription failed/ }))
    expect(screen.getByText('Whisper timed out.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry transcription' }))

    await vi.waitFor(() =>
      expect(posts.map((p) => p.url)).toContain('/api/observations/o9/transcription/retry'),
    )
  })

  it('shows the transcript and the original recording when opened', async () => {
    saved = [
      voiceNote('o7', { status: 'transcribed', transcript: 'Racking sits under two heads.' }),
    ]
    await openObservations()

    const row = await screen.findByRole('button', { name: /Racking sits under two heads/ })
    expect(row).not.toHaveTextContent('Transcribed')
    // Severity and location are what the engineer picked, not the transcription.
    expect(row).toHaveTextContent('High')
    expect(row).toHaveTextContent('Bay 3 — north aisle')
    fireEvent.click(row)

    expect(screen.getAllByText('Racking sits under two heads.').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Original recording')).toHaveAttribute(
      'src',
      '/api/observations/o7/audio',
    )
  })

  it('marks a note still transcribing', async () => {
    saved = [voiceNote('o5', {})]
    await openObservations()

    expect(await screen.findByText('Transcribing')).toBeInTheDocument()
    expect(screen.getByText('Transcribing the recording…')).toBeInTheDocument()
  })
})
