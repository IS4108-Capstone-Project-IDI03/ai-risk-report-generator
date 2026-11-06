import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asProblem, isStopWord, loadSettings, micProblem, saveSettings, spokenText } from './speech'

// Node in CI has no localStorage (a laptop's may), so each test brings its own.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('spokenText (CB-10 AC2)', () => {
  it('drops citation markers and the answer bar', () => {
    const answer = document.createElement('div')
    answer.innerHTML =
      '<p>Use 12 mm <span class="chat-cites"><span>1</span><span>2</span></span> spacing.</p>' +
      '<div class="answer-bar">Try again</div>'
    expect(spokenText(answer)).toBe('Use 12 mm spacing.')
  })
})

describe('voice settings (add-on A)', () => {
  it('round-trips, and falls back to defaults for junk', () => {
    saveSettings({ rate: 1.25, voiceURI: 'v1', handsFree: true })
    expect(loadSettings()).toEqual({ rate: 1.25, voiceURI: 'v1', handsFree: true })
    localStorage.setItem('chat-voice-settings', '{"rate":9,"handsFree":"yes"}')
    expect(loadSettings()).toEqual({ rate: 1, voiceURI: '', handsFree: false })
    localStorage.setItem('chat-voice-settings', 'not json')
    expect(loadSettings().rate).toBe(1)
  })
})

describe('micProblem (CB-10 AC3)', () => {
  it('names plain HTTP, a missing mic and a blocked mic differently', () => {
    vi.stubGlobal('isSecureContext', false)
    expect(micProblem()?.fix).toMatch(/HTTPS/)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } })
    expect(micProblem()).toBeNull()
    expect(micProblem({ name: 'NotFoundError' })?.problem).toBe('No microphone found')
    expect(micProblem({ name: 'NotAllowedError' })?.fix).toMatch(/lock icon/)
  })
})

describe('isStopWord (add-on B)', () => {
  it('matches only a lone "stop"', () => {
    expect(isStopWord(' Stop. ')).toBe(true)
    expect(isStopWord('stop the pump test')).toBe(false)
  })
})

describe('asProblem (design system v2 errors)', () => {
  it('puts the first sentence as the problem and the rest as the fix', () => {
    expect(asProblem('No speech was heard. Try again closer to the microphone.')).toEqual({
      problem: 'No speech was heard',
      fix: 'Try again closer to the microphone.',
    })
    expect(asProblem('Too long')).toEqual({ problem: 'Too long', fix: '' })
  })
})
