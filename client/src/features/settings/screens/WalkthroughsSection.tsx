// Settings > Walkthroughs (F-12): the offers switch, the walkthroughs in groups to tick and play,
// and the practice assessment. The one main button (Play selected) is drawn in the pane's title
// line, through the slot Settings.tsx hands in. Called by Settings.tsx.
// Calls the walkthrough engine (play, setOffers, offerAllAgain), ChecklistGroups and PracticeRow.
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  ChecklistGroups,
  IconAction,
  Switch,
  toast,
  type ChecklistGroup,
} from '../../../design-system'
import { groupsFor } from '../../walkthrough/registry'
import { play, setOffers, offerAllAgain, useWalkthroughs } from '../../walkthrough/engine'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PracticeRow } from '../components/PracticeRow'
import '../walkthroughsSection.css'

/** Returns the Walkthroughs pane; `titleEnd` is the right end of Settings' title line. */
export function WalkthroughsSection({ titleEnd }: { titleEnd: HTMLElement | null }) {
  const role = useWalkthroughs((s) => s.role)
  const record = useWalkthroughs((s) => s.record)
  const [ticked, setTicked] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  // A played walkthrough shows the green done mark; skipped and declined ones show nothing.
  const groups: ChecklistGroup[] = useMemo(
    () =>
      groupsFor(role).map((g) => ({
        id: g.name,
        name: g.name,
        items: g.items.map((item) => ({
          ...item,
          mark: record.seen[item.id]?.state === 'played' ? ('done' as const) : undefined,
          markLabel: 'Played',
        })),
      })),
    [role, record.seen],
  )
  // Play runs the ticked ones in the order listed, never the order they were ticked in.
  const inOrder = groups
    .flatMap((g) => g.items.map((i) => i.id))
    .filter((id) => ticked.includes(id))
  const playButton = (
    <Button
      variant="primary"
      pill
      disabledReason={
        inOrder.length
          ? undefined
          : { title: 'Nothing selected', text: "Tick the walkthroughs you'd like to play." }
      }
      onClick={() => play(inOrder)}
    >
      {inOrder.length
        ? `Play ${inOrder.length} ${inOrder.length === 1 ? 'walkthrough' : 'walkthroughs'}`
        : 'Play selected'}
    </Button>
  )
  // Without the catch, a failed save would be silent while the switch looked changed.
  const saveOffers = (on: boolean) =>
    setOffers(on).catch(() =>
      toast.error("Couldn't save that change", { description: 'Please try again.' }),
    )
  return (
    <div className="wts">
      {titleEnd && createPortal(playButton, titleEnd)}
      <div className="st-switch-row">
        <Switch
          label="Offer walkthroughs on new screens"
          checked={record.offers}
          onChange={saveOffers}
        />
        <IconAction
          icon="megaphone"
          label="Offer all walkthroughs again"
          tooltip="Offer them all again"
          style={{ color: 'var(--graphite-600)' }}
          onClick={() => setAsking(true)}
        />
      </div>
      <ChecklistGroups
        label="Walkthroughs"
        noun="walkthroughs"
        doneWord="played"
        groups={groups}
        selected={ticked}
        onSelectedChange={setTicked}
        renderAction={(item) => (
          <IconAction
            icon="play"
            label={`Play ${item.name}`}
            tooltip="Play walkthrough"
            style={{ color: 'var(--graphite-600)' }}
            onClick={() => play([item.id])}
          />
        )}
      />
      <PracticeRow />
      {asking && (
        <ConfirmDialog
          title="Offer every walkthrough again?"
          body="A quick look around will play again, and every walkthrough will be offered again the first time you open its screen. The ticks for played walkthroughs in this list are cleared too."
          confirm="Offer again"
          run={offerAllAgain}
          done="Every walkthrough will be offered again"
          failed="Couldn't offer the walkthroughs again"
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}
