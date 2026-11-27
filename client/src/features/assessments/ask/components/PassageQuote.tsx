// A passage selected in the draft (AS-02), quoted verbatim behind a 2 px rule under the section
// it is in. Drawn by AskPanel.tsx in the question box (with an × to take it off) and above the
// engineer's bubble once asked (with "Go to the passage", or "Text deleted" once its words are gone).
import { useState } from 'react'
import { Badge, IconButton } from '../../../../design-system'
import { quotedWords, type AskPassage } from '../passage'

// A passage quoted longer than this folds, with a way to read all of it.
const FOLD_AT = 280

/** Returns the quoted passage with its section, and its link back or remove button. */
export function PassageQuote({
  passage,
  heading,
  found,
  onShow,
  onRemove,
}: {
  passage: AskPassage
  heading: string
  // Whether its text is still in the report; undefined where that is not known.
  found?: boolean
  onShow?: () => void
  onRemove?: () => void
}) {
  const [whole, setWhole] = useState(false)
  const words = quotedWords(passage.anchor.exact)
  const long = words.length > FOLD_AT || words.split('\n').length > 4
  return (
    <figure className="ask-passage" aria-label={heading}>
      <figcaption className="ask-passage-head">
        <span className="ask-passage-from">{heading}</span>
        {found === false ? (
          <Badge>Text deleted</Badge>
        ) : (
          found &&
          onShow && (
            <button type="button" className="ask-link" onClick={onShow}>
              Go to the passage
            </button>
          )
        )}
        {onRemove && (
          <IconButton
            icon="x"
            size="sm"
            label="Don't ask about this passage"
            tooltip="Remove the passage"
            onClick={onRemove}
          />
        )}
      </figcaption>
      <blockquote className={'ask-passage-text' + (long && !whole ? ' is-folded' : '')}>
        {words}
      </blockquote>
      {long && (
        <button
          type="button"
          className="ask-link"
          aria-expanded={whole}
          onClick={() => setWhole((open) => !open)}
        >
          {whole ? 'Show less' : 'Show the whole passage'}
        </button>
      )}
    </figure>
  )
}
