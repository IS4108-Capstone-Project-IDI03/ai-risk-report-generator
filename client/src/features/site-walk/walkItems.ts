// The walk read in the order it was made (CP-22 round 1): recordings and typed
// notes by seq, each recording with where it is in its journey. Used by
// useWalk.ts; shown by components/WalkList.tsx. No network or React here.
import type { SiteWalk } from './api'
import type { PendingUpload } from './pendingUploads'

export type RecordingStatus = 'device' | 'sending' | 'transcribing' | 'done' | 'failed'

export type WalkItem =
  | {
      kind: 'recording'
      seq: number
      durationSec: number
      status: RecordingStatus
      transcript: string | null
      audioUrl: string | null
    }
  // `legacy` is text typed before notes existed: shown, but never edited.
  | { kind: 'note'; seq: number; text: string; legacy?: boolean }

const WORDS_IN_NAME = 6

// Returns "“We're now at Block A, level…”" for a transcript, or null while there is none.
export function transcriptName(transcript: string | null) {
  const words = transcript?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!words.length) return null
  const more = words.length > WORDS_IN_NAME
  return `“${words.slice(0, WORDS_IN_NAME).join(' ')}${more ? '…' : ''}”`
}

// "4:12"
export const minutes = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

// Returns the walk's recordings and notes in seq order. `sending` says a send is
// in progress, so a recording only on this device reads "Sending" and not "On this device".
export function walkItems(
  walk: SiteWalk | null,
  unsent: PendingUpload[],
  sending: boolean,
): WalkItem[] {
  if (!walk) return []
  const onServer = new Set(walk.recordings.map((r) => r.seq))
  const items: WalkItem[] = [
    ...walk.recordings.map((r): WalkItem => {
      const status: RecordingStatus =
        r.transcription === 'transcribed'
          ? 'done'
          : r.transcription === 'failed'
            ? 'failed'
            : 'transcribing'
      return {
        kind: 'recording',
        seq: r.seq,
        durationSec: r.durationSec,
        status,
        transcript: r.transcript,
        audioUrl: r.audioUrl,
      }
    }),
    ...unsent.flatMap((i): WalkItem[] =>
      i.kind === 'recording' && !onServer.has(i.seq)
        ? [
            {
              kind: 'recording',
              seq: i.seq,
              durationSec: i.durationSec,
              status: sending ? 'sending' : 'device',
              transcript: null,
              audioUrl: null,
            },
          ]
        : [],
    ),
    ...walk.notes.map((n): WalkItem => ({ kind: 'note', seq: n.seq, text: n.text })),
  ].sort((a, b) => a.seq - b.seq)
  return walk.typedText
    ? [{ kind: 'note', seq: 0, text: walk.typedText, legacy: true }, ...items]
    : items
}
