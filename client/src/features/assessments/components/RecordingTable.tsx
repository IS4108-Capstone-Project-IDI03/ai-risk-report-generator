// The body of All Recordings (CP-12): All Photos' table (PhotoTable.tsx) with a
// play tile where the thumbnail would be. Under the observation: the
// recording's name, where its transcription stands (with Retry), and its
// transcript, which opens by itself when the recording plays. The one playing
// or paused also shows a seek bar, its time and the speed. Rendered by
// screens/Recordings.tsx.
//
// A search (CP-13) finds a recording by its transcript as corrected, its name
// or its observation's text; one that plays and is searched away stops.
import type { CSSProperties, KeyboardEvent } from 'react'
import { Icon } from '../../../design-system'
import { minutes } from '../../site-walk/walkItems'
import type { TranscriptionStatus } from '../api'
import { NO_SPEECH, rowMatches, searchWords, textHits } from '../evidenceSearch'
import { useRecordingPlayer, type Clip, type Playing } from '../useRecordingPlayer'
import { useOpenRows } from '../useOpenRows'
import { HitText } from './HitText'
import { PhotoTable, type PhotoRow, type RowSearch } from './PhotoTable'

export type RecordingRow = Omit<PhotoRow, 'item' | 'url'> & {
  audioUrl: string
  clip: Clip
  status: TranscriptionStatus
  // Starts a new transcription attempt; null unless it failed and may be retried.
  retry: (() => void) | null
  // As corrected, once transcribed.
  transcript: string | null
}

// The arrow keys skip five seconds, as most players do; Home and End are the range's own.
const SKIP = 5

export function RecordingTable({
  rows,
  count,
  search,
}: {
  rows: RecordingRow[]
  count: string
  search: RowSearch
}) {
  const player = useRecordingPlayer()
  const tableRows = rows.map((r) => {
    const transcript = r.transcript
    return {
      ...r,
      item: {
        status: r.status,
        retry: r.retry,
        detail:
          transcript === null
            ? null
            : {
                label: 'Transcript',
                body: (words: readonly string[]) => (
                  <p className="ob-transcript">
                    <HitText text={transcript} words={words} />
                  </p>
                ),
              },
        // Nothing was said in one Whisper heard nothing in.
        searchText: transcript === NO_SPEECH ? null : transcript,
      },
    }
  })
  // Back with a search, the transcripts it found open again.
  const openRows = useOpenRows(() => textHits(tableRows, searchWords(search.query)))
  return (
    <>
      <PhotoTable
        label="Recordings"
        count={count}
        openRows={openRows}
        rows={tableRows}
        search={{
          ...search,
          onQuery: (query) => {
            const words = searchWords(query)
            const on = player.now && tableRows.find((r) => r.key === player.now!.key)
            if (on && !rowMatches(on, words)) player.stop()
            search.onQuery(query)
          },
        }}
        lead={(r) => {
          const playing = player.now?.key === r.key && player.now.playing
          return (
            <button
              type="button"
              className="ob-pt-thumb ob-pt-play"
              aria-label={(playing ? 'Pause ' : 'Play ') + r.name}
              onClick={() => {
                // Its transcript opens to read along; closing it again is the engineer's call.
                if (!playing && r.transcript !== null) openRows.show(r.key)
                void player.toggle(r.key, r.audioUrl, r.clip)
              }}
            >
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            </button>
          )
        }}
        extra={(r) =>
          player.now?.key === r.key && (
            <Seek
              name={r.name}
              on={player.now}
              speed={player.speed}
              onSeek={player.seek}
              onSpeed={player.nextSpeed}
            />
          )
        }
      />
      {/* One player for every row, so only one recording plays at a time. */}
      <audio {...player.audioProps} />
    </>
  )
}

// The playing recording's seek bar, time and speed. Without a known length
// (a browser that can't tell) only the time shows.
function Seek({
  name,
  on,
  speed,
  onSeek,
  onSpeed,
}: {
  name: string
  on: Playing
  speed: number
  onSeek: (to: number) => void
  onSpeed: () => void
}) {
  const { at, length } = on
  const skip = (e: KeyboardEvent<HTMLInputElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? SKIP
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -SKIP
          : 0
    if (!step) return
    e.preventDefault()
    onSeek(at + step)
  }
  return (
    <div className="ob-pt-seek ob-pt-above">
      {length !== null && (
        <input
          type="range"
          className="ob-seek"
          min={0}
          max={length}
          step={0.1}
          value={Math.min(at, length)}
          aria-label={'Position in ' + name}
          aria-valuetext={minutes(at) + ' of ' + minutes(length)}
          // How far it has played, for the filled part of the track.
          style={
            {
              '--seek': (length ? (Math.min(at, length) / length) * 100 : 0) + '%',
            } as CSSProperties
          }
          onChange={(e) => onSeek(Number(e.target.value))}
          onKeyDown={skip}
        />
      )}
      <span className="ob-seek-time">
        {minutes(at)}
        {length !== null && ' / ' + minutes(length)}
      </span>
      <button
        type="button"
        className="ob-seek-speed"
        aria-label={'Playback speed ' + speed + '×'}
        title="Playback speed"
        onClick={onSpeed}
      >
        {speed}×
      </button>
    </div>
  )
}
