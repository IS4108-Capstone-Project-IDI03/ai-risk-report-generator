// Record header (CP-24, v2 NEW pattern): a record's own page header as the client page (CP-23)
// draws it: the round Back button, the record's 44 px tile, an eyebrow over the title, and actions
// at the right. For an observation the tile is its category tile and the eyebrow is where it is.
// Called by the observation page. Calls BackButton.
import type { ReactNode } from 'react'
import { BackButton } from '../navigation/BackButton'

export type RecordHeaderProps = {
  // Where Back goes, e.g. "Observations": the button reads "Back to Observations".
  back: string
  onBack: () => void
  tile: ReactNode
  eyebrow: string
  title: string
  actions?: ReactNode
  // The Back button's data-walk tag (F-12).
  backWalk?: string
}

/** Returns the header row: Back, tile, eyebrow and title, then the actions. */
export function RecordHeader({
  back,
  onBack,
  tile,
  eyebrow,
  title,
  actions,
  backWalk,
}: RecordHeaderProps) {
  return (
    <header className="rh">
      <BackButton label={'Back to ' + back} onClick={onBack} walk={backWalk} />
      <div className="rh-id">
        <span className="rh-tile">{tile}</span>
        <div className="rh-text">
          {eyebrow && <p className="rh-eyebrow">{eyebrow}</p>}
          <h2 className="rh-title" title={title}>
            {title}
          </h2>
        </div>
      </div>
      {actions && <div className="rh-actions">{actions}</div>}
    </header>
  )
}
