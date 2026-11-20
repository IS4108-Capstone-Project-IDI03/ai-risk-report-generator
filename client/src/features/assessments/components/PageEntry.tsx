// A handwritten page on the observation page (CP-19, CP-20, CP-24): drawn as a sibling of the
// recording row (site-walk/components/RecordingRow.tsx), part for part: its quiet white circle
// (pressing it opens the page to zoom), the first words in quotes, a second line with the page's
// name and state, the icon tools, and the chevron last. Open, the text sits in the recording
// transcript's own box. Rendered by screens/ObservationPage.tsx. Calls Icon, PageText.
import { useEffect, useRef, useState } from 'react'
import { Icon, IconRegistry } from '../../../design-system'
import { transcriptName } from '../../site-walk/walkItems'
import type { ObservationPage } from '../types'
import { PageText } from './PageText'

// A handwritten page as the Observations tab and the Scans view show it.
export type PageView = ObservationPage & {
  // Where it stands when there is no text to show, e.g. still transcribing.
  note: string | null
  // A failed transcription, retried by any risk engineer (CP-19 AC11).
  retry: (() => void) | null
  // A finished one, transcribed again by the assigned engineer (CP-20); for
  // a corrected one, this asks first, as the correction goes.
  again: (() => void) | null
  // Its text corrected, or written for a demo page, and the page removed,
  // by whoever may change the observation (CP-20).
  correct: (() => void) | null
  remove: (() => void) | null
  correctedLabel: string | null
  addedLabel: string | null
}

// How long the text takes to close (motion row 4); must match site-walk/walkList.css .sw-text.
const CLOSE_MS = 180

/** Returns the page's row: the round open button, first words, state, tools, and its text when open. */
export function PageEntry({ page: p, onView }: { page: PageView; onView: () => void }) {
  const [open, setOpen] = useState(false)
  // Closing keeps the text drawn while it fades out.
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Without this, a timer left running would set state on a row that has gone.
  useEffect(() => () => clearTimeout(timer.current), [])

  const failed = p.status === 'failed'
  const working = p.status === 'transcribing'
  // What the open text shows: the page's own words, or the reason it has none (blank, demo).
  const text = failed || working ? null : p.note ? 'note' : 'words'
  const opens = text !== null
  // Unsure words are the model's: a corrected page shows the engineer's words, so none count.
  const unsure = !p.correction && p.status === 'transcribed' ? p.uncertain.length : 0
  const name = (!failed && !working && transcriptName(p.transcript)) || p.name
  const expanded = open && !closing
  const more = (!!p.correct || !!p.again) && opens

  // Pressing again during the fade reopens the text: the pending close is cancelled, or a second
  // timer would start and the text would still shut.
  function toggle() {
    clearTimeout(timer.current)
    if (!open || closing) {
      setClosing(false)
      return setOpen(true)
    }
    setClosing(true)
    timer.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, CLOSE_MS)
  }

  return (
    <li
      id={'evidence-' + p.id}
      aria-label={p.name}
      className="sw-item sw-item--rec"
      data-opens={opens || undefined}
      data-more={more || undefined}
    >
      <button
        type="button"
        className="sw-item-icon cpg-open"
        aria-label={'Open ' + p.name}
        onClick={onView}
      >
        <Icon name={IconRegistry.evidence.handwriting} size={18} />
      </button>
      <div className="sw-item-main">
        <p className="sw-item-name">{name}</p>
        {/* Polite live region: Transcribing turns into its words, or Couldn’t transcribe, by itself. */}
        <p className="sw-status-time" aria-live="polite">
          {!failed && !working && <span>{p.name}</span>}
          {unsure > 0 && (
            <>
              <span aria-hidden="true">{'·'}</span>
              <span className="sw-status-word cpg-unsure">
                <Icon name="triangle-alert" size={14} />
                {unsure === 1 ? '1 word unsure' : unsure + ' words unsure'}
              </span>
            </>
          )}
          {working && (
            <span className="sw-status-word">
              <Icon name="loader-circle" size={14} className="sw-spin" />
              {'Transcribing'}
            </span>
          )}
          {failed && (
            <span className="sw-status-word sw-status-word--failed" title={p.error ?? undefined}>
              <Icon name="circle-alert" size={14} />
              {'Couldn’t transcribe'}
              {!!p.error && <span className="ds-sr-only">{p.error}</span>}
            </span>
          )}
        </p>
        {[p.correctedLabel, p.addedLabel].map(
          (line) =>
            !!line && (
              <p key={line} className="sw-stamp">
                {line}
              </p>
            ),
        )}
      </div>
      <div className="sw-item-tools">
        {/* Edit, transcribe again and the bin sit together, before the chevron. */}
        {opens && !!p.correct && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label={'Edit text of ' + p.name}
            title="Correct text"
            onClick={p.correct}
          >
            <Icon name="pencil" size={18} />
          </button>
        )}
        {!!p.again && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label={'Transcribe ' + p.name + ' again'}
            title="Transcribe again"
            onClick={p.again}
          >
            <Icon name="rotate-ccw" size={18} />
          </button>
        )}
        {failed && !!p.retry && (
          <button
            type="button"
            className="sw-button sw-icon-button"
            aria-label={'Try transcribing ' + p.name + ' again'}
            title="Try again"
            onClick={p.retry}
          >
            <Icon name="rotate-ccw" size={18} />
          </button>
        )}
        {/* Kept to restore, never deleted (CP-20). */}
        {!!p.remove && (
          <button
            type="button"
            className="sw-button sw-icon-button sw-button--danger"
            aria-label={'Remove ' + p.name}
            title="Remove page"
            onClick={p.remove}
          >
            <Icon name="trash-2" size={18} />
          </button>
        )}
      </div>
      {opens && (
        <button
          type="button"
          className="sw-button sw-icon-button sw-chev"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide text' : 'Show text'}
          onClick={toggle}
        >
          <Icon name="chevron-down" size={18} />
        </button>
      )}
      {open && opens && (
        <div className="sw-text" data-closing={closing || undefined}>
          <div>
            {text === 'note' ? <p className="sw-transcript">{p.note}</p> : <PageText page={p} />}
          </div>
        </div>
      )}
    </li>
  )
}
