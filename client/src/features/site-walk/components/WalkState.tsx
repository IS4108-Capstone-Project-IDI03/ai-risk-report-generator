// A walk's state cell on the Site Walk Proposals list (CP-24, v2): the state in words, then one
// 16 px mark at the right edge, as the design system's reading status cell draws it.
// Called by WalkRow. Calls ReadingStatus, RowMark.
import { ReadingStatus, RowMark } from '../../../design-system'

export type WalkMark = 'done' | 'failed' | 'working' | 'live' | null

/** Returns the words and their mark: a tick, a red alert, a spinner, a recording dot, or no mark. */
export function WalkState({ words, mark }: { words: string; mark: WalkMark }) {
  if (mark === 'working') return <ReadingStatus state="working" label={words} />
  return (
    <span className="ds-reading wr-state" data-state="working">
      <span className="ds-reading-words">{words}</span>
      {mark === 'live' ? (
        <span className="ds-reading-mark" aria-hidden="true">
          <span className="wr-dot" />
        </span>
      ) : (
        mark && (
          // Hidden from screen readers: the words beside it already say the same.
          <span className="ds-reading-mark" aria-hidden="true">
            <RowMark kind={mark} label={words} />
          </span>
        )
      )}
    </span>
  )
}
