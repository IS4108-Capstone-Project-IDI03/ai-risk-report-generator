// One recording row (CP-22 round 1, Sprint 4 fixes AC15-AC18, CP-24): a name from its transcript
// (or its length), a second line of length and status, and on the right the tools: retry (failed
// only), an optional pencil (`onEdit`), then the red bin; the chevron that opens the transcript is
// ALWAYS the last control, at the far right on the line of the first words. A row that can't open
// yet keeps the chevron's slot empty on a wide screen, so bins line up. Once transcribed it also
// plays. The open transcript is its own line of the row (full width on a phone). Used by
// components/WalkList.tsx (Record a site walk), New Observation and the observation page.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { minutes, transcriptName, type RecordingStatus, type WalkItem } from '../walkItems'
import '../statusReason.css'

// What the row reads from a recording; a WalkItem recording has all of it.
// `durationSec` is null for a saved recording whose length isn't known yet; the row then shows no length.
export type RecordingRowItem = Pick<
  Extract<WalkItem, { kind: 'recording' }>,
  'status' | 'transcript' | 'audioUrl'
> & { durationSec: number | null }

// How long the transcript takes to close (motion row 4); must match walkList.css .sw-text.
const CLOSE_MS = 180

// The icon and words after the length; a transcribed recording shows none.
const STATUS: Record<Exclude<RecordingStatus, 'done'>, { icon: string; word: string }> = {
  device: { icon: 'smartphone', word: 'On this device' },
  sending: { icon: 'loader-circle', word: 'Sending' },
  transcribing: { icon: 'loader-circle', word: 'Transcribing' },
  failed: { icon: 'circle-alert', word: 'Couldn’t transcribe' },
}

// Shows a recording’s progress, transcript, playback and its retry, edit and remove buttons.
export function RecordingRow({
  item,
  phone,
  id,
  onRetry,
  onRemove,
  onEdit,
  label,
  stamps,
  error,
}: {
  item: RecordingRowItem
  phone: boolean
  // An anchor for links that scroll to this recording.
  id?: string
  // Without one the button is not drawn (a view-only user, or the only thing an observation holds).
  onRetry?: () => void
  onRemove?: () => void
  // A pencil before the bin, e.g. to correct the transcript on the observation page.
  onEdit?: () => void
  // The recording's own name ("Recording 2"): names its bin, and names the row when it has no transcript or length yet.
  label?: string
  // Who added or corrected it, as short lines under the length (the observation page).
  stamps?: string[]
  // Why a failed transcription failed: a tooltip, and read out by screen readers.
  error?: string | null
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(false)
  // Closing keeps the text drawn while it fades out.
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Without this, a timer left running would set state on a row that has gone.
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const status = item.status === 'done' ? null : STATUS[item.status]
  const working = item.status === 'sending' || item.status === 'transcribing'
  // Null while a saved recording's length isn't known yet: nothing shows rather than a name.
  const length = item.durationSec === null ? null : minutes(item.durationSec)
  const name =
    transcriptName(item.transcript) ??
    (length === null ? (label ?? 'Recording') : `Recording · ${length}`)
  const canPlay = item.status === 'done' && !!item.audioUrl
  const opens = !!item.transcript
  const expanded = open && !closing

  function toggle() {
    const el = audio.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  // Pressing again during the fade reopens the transcript: the pending close is cancelled, or a
  // second timer would start and the text would still shut.
  function toggleText() {
    clearTimeout(closeTimer.current)
    if (!open || closing) {
      setClosing(false)
      return setOpen(true)
    }
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, CLOSE_MS)
  }

  return (
    <li
      id={id}
      aria-label={label}
      className="sw-item sw-item--rec"
      data-opens={opens || undefined}
      data-more={(!!onEdit && opens) || undefined}
    >
      {canPlay ? (
        <button
          type="button"
          className="sw-play"
          aria-label={playing ? 'Pause playback' : 'Play recording'}
          onClick={toggle}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
      ) : (
        <span className="sw-item-icon" aria-hidden="true">
          <Icon name="mic" size={18} />
        </span>
      )}
      <div className="sw-item-main">
        <p className="sw-item-name">{name}</p>
        {/* Polite live region: Transcribing turns into its words, or Couldn’t transcribe, by itself. */}
        <p className="sw-status-time" aria-live="polite">
          {length !== null && <span>{length}</span>}
          {status && (
            <>
              {length !== null && <span aria-hidden="true">·</span>}
              <span
                className={'sw-status-word sw-status-word--' + item.status}
                title={(item.status === 'failed' && error) || undefined}
              >
                <Icon name={status.icon} size={14} className={working ? 'sw-spin' : undefined} />
                {/* On a phone the failed word is the action; screen readers still hear the problem. */}
                {item.status === 'failed' && phone ? (
                  <>
                    <span aria-hidden="true">Try again</span>
                    <span className="ds-sr-only">{status.word}</span>
                  </>
                ) : (
                  status.word
                )}
                {item.status === 'failed' && !!error && <span className="ds-sr-only">{error}</span>}
              </span>
            </>
          )}
        </p>
        {/* aria-hidden: screen readers already hear the reason in the status line. */}
        {item.status === 'failed' && !!error && (
          <p className="sw-status-reason" aria-hidden="true">
            {error}
          </p>
        )}
        {stamps?.map((line) => (
          <p key={line} className="sw-stamp">
            {line}
          </p>
        ))}
      </div>
      {/* Retry, edit and the bin sit together, before the chevron. */}
      <div className="sw-item-tools">
        {item.status === 'failed' && onRetry && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label="Try transcribing again"
            title="Try again"
            onClick={onRetry}
          >
            <Icon name="rotate-ccw" size={18} />
          </button>
        )}
        {onEdit && opens && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label="Correct the transcript"
            title="Correct transcript"
            onClick={onEdit}
          >
            <Icon name="pencil" size={18} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="sw-button sw-icon-button sw-button--danger"
            aria-label={label ? 'Remove ' + label : 'Remove recording'}
            title="Remove recording"
            onClick={onRemove}
          >
            <Icon name="trash-2" size={18} />
          </button>
        )}
      </div>
      {/* Always the last control. Without a transcript the cell stays empty on a wide screen. */}
      {opens && (
        <button
          type="button"
          className="sw-button sw-icon-button sw-chev"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide transcript' : 'Show transcript'}
          onClick={toggleText}
        >
          {/* One icon turned half a turn, in the same time as the text opens (motion row 4). */}
          <Icon name="chevron-down" size={18} />
        </button>
      )}
      {open && item.transcript && (
        <div className="sw-text" data-closing={closing || undefined}>
          <div>
            <p className="sw-transcript">{item.transcript}</p>
          </div>
        </div>
      )}
      {canPlay && (
        <audio
          ref={audio}
          src={item.audioUrl ?? undefined}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </li>
  )
}
