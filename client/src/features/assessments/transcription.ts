import type { TranscriptionStatus } from './api'

// How a transcription stands, for a recording (CP-03) or a handwritten page
// (CP-19), as a badge's tone and label.
export const TRANSCRIPTION_BADGE = {
  transcribing: { tone: 'info', label: 'Transcribing' },
  transcribed: { tone: 'low', label: 'Transcribed' },
  failed: { tone: 'high', label: 'Failed' },
} as const satisfies Record<TranscriptionStatus, { tone: string; label: string }>
