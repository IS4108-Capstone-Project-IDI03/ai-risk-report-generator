// What the Voice tab of New Observation lists (CP-24): the draft's recordings as the shared
// RecordingRow reads them. Used by useAssessmentWorkflow.tsx, drawn by components/CaptureVoicePanel.tsx.
// No network or React here.
import type { RecordingRowItem } from '../site-walk/components/RecordingRow'
import type { SavedRecording } from './api'

// One row, with what its tools do.
export type CaptureRecording = {
  key: string
  item: RecordingRowItem
  onRetry: () => void
  onRemove: () => void
}

/** Returns a draft recording as its row reads it: the corrected words win, and a length not known yet is 0. */
export function draftItem(r: SavedRecording, lengths: Record<string, number>): RecordingRowItem {
  const { status, transcript, correction } = r.transcription
  return {
    durationSec: lengths[r.name] ?? 0,
    status: status === 'transcribed' ? 'done' : status,
    transcript: status === 'transcribed' ? (correction?.text ?? transcript) : null,
    audioUrl: r.url,
  }
}
