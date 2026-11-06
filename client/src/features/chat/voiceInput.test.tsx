// The mic in the chat box (CB-10): Pause and Stop while recording, then the transcript in the box.
// The recorder, microphone and gateway are fakes; OpenUI's chat state is a stub.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInput } from './components/VoiceInput'
import { saveSettings } from './speech'

let heard = true
// 'suspended' is what Safari gives an audio meter created outside a click.
let contextState: 'running' | 'suspended' = 'running'
const processMessage = vi.fn()
vi.mock('@openuidev/react-headless', async (original) => ({
  ...(await original<object>()),
  useThread: (pick: (s: { processMessage: typeof processMessage }) => unknown) =>
    pick({ processMessage }),
}))

// A recorder that only remembers what it was told; stop() ends it like the real one.
class FakeRecorder {
  static last: FakeRecorder
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  pause = vi.fn(() => void (this.state = 'paused'))
  resume = vi.fn(() => void (this.state = 'recording'))
  constructor() {
    FakeRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio']) })
    void this.onstop?.()
  }
}

beforeEach(() => {
  document.body.innerHTML =
    '<div class="knowledge-assistant"><div class="openui-agent-thread-composer">' +
    '<div class="openui-agent-thread-composer__input-wrapper"><textarea></textarea></div></div></div>'
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = contextState
      resume = async () => {}
      createAnalyser = () => ({
        fftSize: 4,
        // A microphone that hears something, unless a test says otherwise.
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(heard ? 0.1 : 0),
      })
      createMediaStreamSource = () => ({ connect: () => {} })
      close = async () => {}
    },
  )
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }],
        getAudioTracks: () => [{ label: 'Test Mic' }],
      }),
    },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  saveSettings({ rate: 1, voiceURI: '', handsFree: false })
  processMessage.mockClear()
  heard = true
  vi.stubGlobal('fetch', async () => Response.json({ text: 'What is the density for OH2?' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The level is read every 100 ms; wait for one reading, as a real recording would have.
const listened = () => act(() => new Promise((done) => setTimeout(done, 160)))

describe('ask by voice (CB-10)', () => {
  it('shows Pause and Stop while recording, and Stop puts the transcript in the box (AC1)', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await listened()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    await waitFor(() =>
      expect(document.querySelector('textarea')).toHaveValue('What is the density for OH2?'),
    )
    // Back to the mic, ready for the next question.
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeInTheDocument()
  })

  it('Pause holds the recording and Resume carries on', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pause recording' }))
    expect(FakeRecorder.last.pause).toHaveBeenCalled()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }))
    expect(FakeRecorder.last.resume).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument()
  })

  it('says why when the gateway cannot read the clip', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'No speech was heard. Try again closer.' }, { status: 422 }),
    )
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await listened()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('No speech was heard')).toBeInTheDocument()
  })

  it('turns hands-free on from the mic cog, so the question is sent without being checked', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hands-free settings' }))
    // Switched on mid-recording: it counts when the recording ends.
    fireEvent.click(screen.getByRole('switch', { name: /Hands-free/ }))
    await listened()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await waitFor(() =>
      expect(processMessage).toHaveBeenCalledWith({
        role: 'user',
        content: 'What is the density for OH2?',
      }),
    )
    expect(document.querySelector('textarea')).toHaveValue('')
  })

  it('does not send a clip with no sound in it, and says to check the microphone', async () => {
    heard = false
    const gateway = vi.fn(async () => Response.json({ text: 'never asked' }))
    vi.stubGlobal('fetch', gateway)
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await listened()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('No sound from your microphone')).toBeInTheDocument()
    // Whisper would have invented "Thank you for watching." for it.
    expect(gateway).not.toHaveBeenCalled()
  })

  it('shows a level meter while listening', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await listened()
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toBeInTheDocument()
  })

  it('names the microphone it listened to when it heard nothing', async () => {
    heard = false
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await listened()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText(/Input used: Test Mic/)).toBeInTheDocument()
  })

  it('still records when the browser will not run the level meter, and waits for Stop', async () => {
    // Safari leaves a meter made outside a click suspended: it reads zero however loud you are.
    heard = false
    contextState = 'suspended'
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    expect(await screen.findByText(/press Stop when you finish/i)).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    await listened()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    // Not mistaken for a silent microphone: the clip goes to be transcribed.
    await waitFor(() =>
      expect(document.querySelector('textarea')).toHaveValue('What is the density for OH2?'),
    )
  })
})
