// One recording in the walk list (CP-22 round 1): a name from its transcript (or
// its length), a status icon on the right (no words; each has a label for screen
// readers) and, once transcribed, playback and the transcript. Used by components/WalkList.tsx.
import { useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { minutes, transcriptName, type RecordingStatus, type WalkItem } from '../walkItems'

const STATUS: Record<RecordingStatus, { icon: string; word: string }> = {
  device: { icon: 'smartphone', word: 'On this device' },
  sending: { icon: 'loader', word: 'Sending' },
  transcribing: { icon: 'loader', word: 'Transcribing' },
  done: { icon: 'check', word: 'Transcribed' },
  failed: { icon: 'x', word: 'Couldn’t transcribe' },
}

// Shows a recording’s progress, transcript and playback controls.
export function RecordingRow({ item }: { item: Extract<WalkItem, { kind: 'recording' }> }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(false)
  const status = STATUS[item.status]
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
        <p className="sw-status-time">{minutes(item.durationSec)}</p>
        {open && item.transcript && <p className="sw-transcript">{item.transcript}</p>}
      </div>
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
      <span
        role="img"
        aria-label={status.word}
        title={status.word}
        className={'sw-state sw-state--' + item.status}
      >
        <Icon name={status.icon} size={16} />
      </span>
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
