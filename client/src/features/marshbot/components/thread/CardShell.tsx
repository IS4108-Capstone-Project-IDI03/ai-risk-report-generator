// The frame every card shares (AS-06 canvas C1 onward): a white card under MarshBot's bubbles,
// its 1-2 word title, a short note on the right ("0 of 2 done", the count bold), then its body.
// Wide cards (checklist, bars, outline, lanes, time in stage) take
// the whole conversation column.
// Used by every card in this folder.
import type { ReactNode } from 'react'
import { Icon, Tooltip } from '../../../../design-system'

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
        {/* The title and its (?): the anchor of the help bubble, so it starts at the title's left edge. */}
        <div className="mbt-card-title">
          <h3>{title}</h3>
          {help && (
            // A full sentence: it wraps at 280 px and opens under the title from its left edge (the
            // wrapper is static, so .mbt-card-title is its anchor), inside the card at every width.
            // `tap`: a phone has no hover, and iOS does not focus a tapped button.
            <Tooltip
              label={help}
              placement="bottom-start"
              maxWidth={280}
              tap
              style={{ position: 'static' }}
            >
              <button type="button" className="mbt-help" aria-label={help}>
                <Icon name="circle-help" size={16} />
              </button>
            </Tooltip>
          )}
        </div>
        {note && <Note text={note} />}
      </header>
      {children}
    </div>
  )
}
