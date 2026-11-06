// Reading an answer aloud (CB-10): a new speed or voice applies at once, from the word being read.
// speechSynthesis is a fake that records what it is asked to say.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayAnswer } from './components/PlayAnswer'
import { saveSettings } from './speech'

class FakeVoice {
  static said: FakeVoice[] = []
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  onboundary: ((e: { charIndex: number }) => void) | null = null
  text: string
  constructor(text: string) {
    this.text = text
  }
}

beforeEach(() => {
  FakeVoice.said = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeVoice)
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ voiceURI: 'v2', name: 'Two', lang: 'en-GB' }],
    speak: (u: FakeVoice) => {
      FakeVoice.said.push(u)
      u.onstart?.()
    },
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  saveSettings({ rate: 1, voiceURI: '', handsFree: false })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('read aloud (CB-10 add-on A)', () => {
  it('carries on from the same word at the new speed, with no stop and start', async () => {
    const answer = document.createElement('div')
    answer.textContent = 'Use twelve millimetres spacing for light hazard.'
    render(<PlayAnswer answer={answer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read answer aloud' }))
    const first = FakeVoice.said[0]
    expect(first.rate).toBe(1)

    // The voice has reached "millimetres" when the engineer picks 1.5x.
    act(() => first.onboundary?.({ charIndex: 11 }))
    act(() => saveSettings({ rate: 1.5, voiceURI: 'v2', handsFree: false }))

    expect(FakeVoice.said).toHaveLength(2)
    const second = FakeVoice.said[1]
    expect(second.text).toBe('millimetres spacing for light hazard.')
    expect(second.rate).toBe(1.5)
    expect(second.voice).toMatchObject({ voiceURI: 'v2' })
  })

  it('does nothing when nothing is being read', () => {
    const answer = document.createElement('div')
    answer.textContent = 'Some answer.'
    render(<PlayAnswer answer={answer} />)
    act(() => saveSettings({ rate: 1.25, voiceURI: '', handsFree: false }))
    expect(FakeVoice.said).toHaveLength(0)
  })
})
