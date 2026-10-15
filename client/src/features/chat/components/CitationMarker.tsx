// One citation marker after a statement or table cell (CB-01 AC1, AC2, AC14): a violet
// mono numeral, as in the review workspace. Choosing it opens the source panel beside the chat.
// Used by ../library.tsx's Cite; the panel is CitationPanel.tsx.
import { useContext } from 'react'
import { pages } from '../../assessments/reviewDisplay'
import { CitationNumbersContext, checkKey, useCitationCheck } from './citationCheck'
import { CitationSelectionContext } from './citationSelection'
import { documentLabel, useDocument } from './documents'

type Props = { passage: string; quote: string }

/** A numbered marker that opens where a statement came from. */
export function CitationMarker({ passage, quote }: Props) {
  const { source, state } = useCitationCheck(passage, quote)
  const doc = useDocument(source?.documentId)
  const number = useContext(CitationNumbersContext).get(checkKey(passage, quote))
  const { selected, select } = useContext(CitationSelectionContext)
  // The quote check may omit a page; pages() takes a missing page as null.
  const range =
    source && pages({ pageStart: source.pageStart ?? null, pageEnd: source.pageEnd ?? null })
  // Read aloud as "Citation 2: NFPA 13 (2022), page 81, unverified": five markers citing
  // different pages no longer sound identical.
  const where = [doc && documentLabel(doc), range && `page ${range}`].filter(Boolean).join(', ')
  const name = [
    `Citation ${number ?? ''}${where ? `: ${where}` : ''}`,
    state === 'unverified' && 'unverified',
    source?.withdrawn && 'withdrawn edition',
  ]
    .filter(Boolean)
    .join(', ')
  const current =
    selected?.passage === passage &&
    selected.quote === quote &&
    selected.source?.documentId === source?.documentId

  const open = (from: HTMLElement) =>
    number != null && select({ number, passage, quote, state, source }, from)

  // An inline span acting as a button, not a <button>: Chrome breaks a line before a
  // <button> even after a no-break space, so a number could start a line on its own.
  return (
    <span
      role="button"
      tabIndex={0}
      className={`rv-cite chat-cite chat-cite--${state}`}
      aria-label={name}
      aria-current={current ? 'true' : undefined}
      onClick={(event) => open(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault() // without this, Space would scroll the page
        open(event.currentTarget)
      }}
    >
      {number ?? '·'}
      {state === 'unverified' && <span aria-hidden="true">!</span>}
    </span>
  )
}
