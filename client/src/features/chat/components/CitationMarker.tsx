// One citation marker after a statement or table cell (CB-01 AC1, AC2, AC14): a violet
// mono numeral, as in the review workspace. Choosing it opens the source panel beside the chat.
// Used by ../library.tsx's Cite; the panel is CitationPanel.tsx.
import { useContext } from 'react'
import { pages } from '../../assessments/reviewDisplay'
import { CitationNumbersContext, useCitationCheck } from './citationCheck'
import { CitationSelectionContext } from './citationSelection'
import { documentLabel, useDocument } from './documents'

type Props = { passage: string; quote: string }

/** A numbered marker that opens where a statement came from. */
export function CitationMarker({ passage, quote }: Props) {
  const { source, state } = useCitationCheck(passage, quote)
  const doc = useDocument(source?.documentId)
  const number = useContext(CitationNumbersContext).get(passage)
  const { selected, select } = useContext(CitationSelectionContext)
  const range = source && pages(source)
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

  return (
    <button
      type="button"
      className={`rv-cite chat-cite chat-cite--${state}`}
      aria-label={name}
      aria-current={current ? 'true' : undefined}
      onClick={(event) =>
        number != null && select({ number, passage, quote, state, source }, event.currentTarget)
      }
    >
      {number ?? '·'}
      {state === 'unverified' && <span aria-hidden="true">!</span>}
    </button>
  )
}
