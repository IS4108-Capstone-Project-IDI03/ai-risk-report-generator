// The top of every Observations sub-screen (CP-22 round 1), built like the
// Recording screen's bar so every screen reads the same: the round Back on the left (v2),
// the Title Case name centred with one line of live detail under it (counts,
// where it saves). Used by New Observation, Site Walks, All Photos, All
// Handwritten Pages and a site walk proposal, which adds a rename pencil after
// the title, a Proposal badge above it and its actions on the right.
import type { ReactNode } from 'react'
import { BackButton } from '../../../design-system'
import './screen-header.css'

export function ScreenHeader({
  title,
  detail,
  back,
  onBack,
  backWalk,
  titleAction,
  badge,
  actions,
}: {
  // Title Case, e.g. "New Observation".
  title: string
  detail?: ReactNode
  // Where Back goes, read out as "Back to …".
  back: string
  onBack: () => void
  // F-12: Back's data-walk tag, for a walkthrough to press.
  backWalk?: string
  // A small icon button right after the title, e.g. Rename.
  titleAction?: ReactNode
  // Above the title, centred: what kind of screen this is, e.g. Proposal.
  badge?: ReactNode
  // At the bar's right end; under the title on a phone.
  actions?: ReactNode
}) {
  return (
    // The header measures its own width (screen-header.css), so the row inside it can stack.
    <header className="sh">
      <div className="sh-in">
        <BackButton label={'Back to ' + back} onClick={onBack} walk={backWalk} />
        <div className="sh-text">
          {!!badge && <div className="sh-badge">{badge}</div>}
          <h2 className="sh-title">
            {title}
            {titleAction}
          </h2>
          {detail != null && <p className="sh-detail">{detail}</p>}
        </div>
        {actions && <div className="sh-actions">{actions}</div>}
      </div>
    </header>
  )
}
