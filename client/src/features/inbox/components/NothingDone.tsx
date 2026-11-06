// The Done tab's empty state (F-10 round 2, item 3): a grey circle with the inbox icon, "Nothing
// done yet" and a line of help. Used by InboxList. Shares .inbox-empty with AllDone, so the
// two cards are the same height and switching tabs doesn't make the card jump.
import { Icon } from '../../../design-system'

/** Returns the Done tab's empty card. */
export function NothingDone() {
  return (
    <div className="inbox-empty">
      <span className="inbox-empty__icon">
        <Icon name="inbox" size={20} />
      </span>
      <p>Nothing done yet</p>
      <p className="inbox-empty__help">Items you open or tick show up here.</p>
    </div>
  )
}
