// The frame every card shares (AS-06 canvas C1 onward): a white card under MarshBot's bubbles,
// its 1-2 word title, a short note on the right ("0 of 2 done", the count bold), then its body.
// Wide cards (checklist, bars, outline, lanes, time in stage) take
// the whole conversation column.
// Used by every card in this folder.
import type { ReactNode } from 'react'
import { HelpTip } from '../../../../design-system'

// "25 of 42 answered" with the 25 bold; any other note as it is.
function Note({ text }: { text: string }) {
  const m = /^(\d+)( of .*)$/.exec(text)
  return <small>{m ? [<b key="n">{m[1]}</b>, m[2]] : text}</small>
}

/** Returns the card frame around `children`. */
export function CardShell({
  title,
  note,
  help,
  wide = false,
  children,
}: {
  title: string
  note?: string | null
  // A (?) beside the title with this explanation.
  help?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    // A named group, not a region: a long history would otherwise be a long list of landmarks.
    <div className="mbt-card" role="group" data-wide={wide || undefined} aria-label={title}>
      <header className="mbt-card-head">
        {/* The title and its (?). */}
        <div className="mbt-card-title">
          <h3>{title}</h3>
          {/* The same (?) as every help tip (F-13). It opens under the title from its left edge. */}
          {help && (
            <HelpTip label={`About ${title}`} align="left">
              <p>{help}</p>
            </HelpTip>
          )}
        </div>
        {note && <Note text={note} />}
      </header>
      {children}
    </div>
  )
}
