// The mic in the chat box (CB-10): Pause and Stop while recording, then the transcript in the box.
// The recorder, microphone and gateway are fakes; OpenUI's chat state is a stub.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInput } from './components/VoiceInput'
import { saveSettings } from './speech'

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
      createAnalyser = () => ({ fftSize: 4, getFloatTimeDomainData: () => {} })
      createMediaStreamSource = () => ({ connect: () => {} })
      close = async () => {}
    },
  )
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  saveSettings({ rate: 1, voiceURI: '', handsFree: false })
  processMessage.mockClear()
  vi.stubGlobal('fetch', async () => Response.json({ text: 'What is the density for OH2?' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ask by voice (CB-10)', () => {
  it('shows Pause and Stop while recording, and Stop puts the transcript in the box (AC1)', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('No speech was heard')).toBeInTheDocument()
  })

  it('turns hands-free on from the mic cog, so the question is sent without being checked', async () => {
    render(<VoiceInput />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hands-free settings' }))
    // Switched on mid-recording: it counts when the recording ends.
    fireEvent.click(screen.getByRole('switch', { name: /Hands-free/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await waitFor(() =>
      expect(processMessage).toHaveBeenCalledWith({
        role: 'user',
        content: 'What is the density for OH2?',
      }),
    )
    expect(document.querySelector('textarea')).toHaveValue('')
  })
})
