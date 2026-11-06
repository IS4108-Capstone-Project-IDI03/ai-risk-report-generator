// One recording in the walk list (CP-22 round 1, Sprint 4 fixes AC15-AC18): a name from its
// transcript (or its length), a second line of length and status, and on the right retry
// (failed only), the transcript chevron and a red bin. Once transcribed it also plays.
// Used by components/WalkList.tsx.
import { useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { minutes, transcriptName, type RecordingStatus, type WalkItem } from '../walkItems'

// The icon and words after the length; a transcribed recording shows none.
const STATUS: Record<Exclude<RecordingStatus, 'done'>, { icon: string; word: string }> = {
  device: { icon: 'smartphone', word: 'On this device' },
  sending: { icon: 'loader-circle', word: 'Sending' },
  transcribing: { icon: 'loader-circle', word: 'Transcribing' },
  failed: { icon: 'circle-alert', word: 'Couldn’t transcribe' },
}

// Shows a recording’s progress, transcript, playback and its retry and remove buttons.
export function RecordingRow({
  item,
  phone,
  onRetry,
  onRemove,
}: {
  item: Extract<WalkItem, { kind: 'recording' }>
  phone: boolean
  onRetry: () => void
  onRemove: () => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(false)
  const status = item.status === 'done' ? null : STATUS[item.status]
  const working = item.status === 'sending' || item.status === 'transcribing'
  const name = transcriptName(item.transcript) ?? `Recording · ${minutes(item.durationSec)}`
  const canPlay = item.status === 'done' && !!item.audioUrl

  function toggle() {
    const el = audio.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  return (
    <li className="sw-item">
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
        <p className="sw-status-time">
          <span>{minutes(item.durationSec)}</span>
          {status && (
            <>
              <span aria-hidden="true">·</span>
              <span className={'sw-status-word sw-status-word--' + item.status}>
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
              </span>
            </>
          )}
        </p>
        {open && item.transcript && <p className="sw-transcript">{item.transcript}</p>}
      </div>
      <div className="sw-item-tools">
        {item.status === 'failed' && (
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
        {item.transcript && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-expanded={open}
            aria-label={open ? 'Hide transcript' : 'Show transcript'}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
          </button>
        )}
        <button
          type="button"
          className="sw-button sw-icon-button sw-button--danger"
          aria-label="Remove recording"
          title="Remove recording"
          onClick={onRemove}
        >
          <Icon name="trash-2" size={18} />
        </button>
      </div>
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
