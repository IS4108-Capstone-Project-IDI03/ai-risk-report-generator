// Voice helpers for the chat (CB-10): the text to read aloud, the saved voice settings, the
// microphone's problem message, and the stop word. Used by components/VoiceInput.tsx,
// PlayAnswer.tsx and VoiceSettings.tsx.
import { useSyncExternalStore } from 'react'

/** The answer's words without its citation markers or the Try-again bar, as a person would say them. */
export function spokenText(answer: Element): string {
  const copy = answer.cloneNode(true) as Element
  // Without this the voice would read "1 2 3" after every statement.
  copy.querySelectorAll('.chat-cites, .answer-bar').forEach((el) => el.remove())
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Whether this browser can read text aloud; false hides Play (AC4). */
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// The voice settings live in this browser: the voice list differs per device, so a saved
// voice from a laptop would not exist on a phone.
export type VoiceSettings = { rate: number; voiceURI: string; handsFree: boolean }
const KEY = 'chat-voice-settings'
const DEFAULTS: VoiceSettings = { rate: 1, voiceURI: '', handsFree: false }

/** Returns the saved settings, or the defaults when none are saved or the store is blocked. */
export function loadSettings(): VoiceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceSettings>
    const rate = Number(saved.rate)
    return {
      rate: rate >= 0.75 && rate <= 1.5 ? rate : DEFAULTS.rate,
      voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI : DEFAULTS.voiceURI,
      handsFree: saved.handsFree === true,
    }
  } catch {
    return DEFAULTS
  }
}
/** Saves the settings; a blocked store just means they are not remembered. */
export function saveSettings(settings: VoiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Not remembered; the controls still work for this visit.
  }
  current = settings
  listeners.forEach((tell) => tell())
}

// The mic button and the Play bar sit in different places but share one set of settings.
let current: VoiceSettings | null = null
const listeners = new Set<() => void>()
const read = () => (current ??= loadSettings())

/** The live settings and a function that changes some of them (and saves). */
export function useVoiceSettings() {
  const settings = useSyncExternalStore(
    (tell) => (listeners.add(tell), () => void listeners.delete(tell)),
    read,
  )
  return [settings, (change: Partial<VoiceSettings>) => saveSettings({ ...settings, ...change })] as const
}

/** What went wrong and what to do about it, as design system v2 shows errors: a short problem, then the fix. */
export type Problem = { problem: string; fix: string }

/** Splits a gateway message ("No speech was heard. Try again.") into its problem and fix. */
export function asProblem(message: string): Problem {
  const [problem, ...rest] = message.split(/(?<=\.)\s+/)
  return { problem: problem.replace(/\.$/, ''), fix: rest.join(' ') }
}

/** Why the microphone cannot be used; null when it can. */
export function micProblem(error?: unknown): Problem | null {
  // Browsers allow the microphone only on HTTPS or localhost (Marsh's note on plain HTTP).
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    return {
      problem: 'Microphone unavailable here',
      fix: 'This page is not secure (HTTP). Open the app over HTTPS, or on localhost.',
    }
  if (error && (error as { name?: string }).name === 'NotFoundError')
    return { problem: 'No microphone found', fix: 'Plug one in, then try again.' }
  if (error)
    return {
      problem: 'Microphone blocked',
      fix: 'Allow it from the lock icon in the address bar, then try again.',
    }
  return null
}

/** True for a spoken "stop" (any case, with or without a full stop), which ends hands-free mode. */
export const isStopWord = (text: string) => /^stop[.!]?$/i.test(text.trim())

// Tells the mic that the answer has finished being read, so hands-free mode can listen again.
export const answerSpoken = new EventTarget()

// Set when hands-free sends a spoken question, so only that answer is read out by itself.
// Without it, reopening an old chat would start reading its last answer.
export const handsFreeTurn = { waiting: false }
