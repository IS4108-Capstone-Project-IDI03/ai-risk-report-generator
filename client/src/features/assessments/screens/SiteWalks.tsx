// The Site Walk Proposals screen (CP-22 AC5, AC14, round 3, tabs round 4): one
// full-width card with Ready to review, In progress and Added to the assessment
// as tabs across its top, then that tab's walks, one compact row each, with
// Record site walk in the header. A walk stays a
// proposal until Create all adds it; until then it can be deleted. Opened from
// the Observations toolbar; rendered by screens/Observations.tsx.
import { useState } from 'react'
import { EmptyState, Icon } from '../../../design-system'
import type { SiteWalk } from '../../site-walk'
import { DeleteWalkDialog } from '../../site-walk/components/DeleteWalkDialog'
import { WalkRow } from '../../site-walk/components/WalkRow'
import { problemText } from '../../site-walk/useWalk'
import { ScreenHeader } from '../components/ScreenHeader'
import { WALK_TABS, WalkTabs, type WalkTab } from '../components/WalkTabs'
import '../observations.css'
import '../../site-walk/walkRows.css'

const EMPTY: Record<WalkTab, string> = {
  ready: 'Nothing to review',
  working: 'Nothing in progress',
  added: 'Nothing added yet',
}

// Which group a walk sits in.
const tabOf = (w: SiteWalk): WalkTab =>
  w.status === 'ready' ? 'ready' : w.status === 'created' ? 'added' : 'working'

export function SiteWalks({
  walks,
  waiting,
  onBack,
  onRecord,
  onOpen,
  onRetry,
  onDelete,
}: {
  walks: SiteWalk[]
  // Files kept on this device until the engineer is online again.
  waiting: number
  onBack: () => void
  onRecord: () => void
  onOpen: (walk: SiteWalk) => void
  onRetry: (walkId: string) => void
  // Deletes the walk on the gateway; rejects with why it could not.
  onDelete: (walkId: string) => Promise<void>
}) {
  const [picked, setPicked] = useState<WalkTab | null>(null)
  const [deleting, setDeleting] = useState<{
    walk: SiteWalk
    busy: boolean
    problem: string | null
  } | null>(null)
  // a. The groups, newest first; the first with walks opens unless one was picked.
  const sorted = [...walks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const counts = { ready: 0, working: 0, added: 0 }
  for (const w of sorted) counts[tabOf(w)]++
  const tab = picked ?? WALK_TABS.find((t) => counts[t.tab])?.tab ?? 'ready'
  const shown = sorted.filter((w) => tabOf(w) === tab)

  // b. Delete, once confirmed; the dialog stays open with the reason if refused.
  function confirmDelete() {
    if (!deleting) return
    setDeleting({ ...deleting, busy: true, problem: null })
    onDelete(deleting.walk.id).then(
      () => setDeleting(null),
      (e: unknown) =>
        setDeleting(
          (d) =>
            d && {
              ...d,
              busy: false,
              problem: problemText(e, 'It could not be deleted. Try again.'),
            },
        ),
    )
  }

  // The same button as on the Observations toolbar, so one action looks one way.
  const record = (
    <button type="button" className="ob-button ob-button--primary" onClick={onRecord}>
      <Icon name="mic" size={16} />
      Record site walk
    </button>
  )
  return (
    // .ob: the Observations tab's look (cards, buttons) for the list.
    <div className="ob wr-screen">
      <ScreenHeader
        title="Site Walk Proposals"
        back="Observations"
        onBack={onBack}
        actions={walks.length > 0 ? record : undefined}
      />
      {walks.length === 0 && !waiting ? (
        <EmptyState
          icon="mic"
          title="No site walk proposals yet"
          description="Record a site walk and the AI proposes observations from it."
          action={record}
        />
      ) : (
        // Not fitted to the screen: the card is as tall as its rows (round 5).
        <div className="ob-layout">
          <section className="ob-card" aria-label={WALK_TABS.find((t) => t.tab === tab)!.label}>
            <WalkTabs tab={tab} counts={counts} onPick={setPicked} />
            {waiting > 0 && (
              <p className="ob-walks-waiting" role="status">
                {`${waiting} ${waiting === 1 ? 'file is' : 'files are'} waiting to send. We’ll send ${waiting === 1 ? 'it' : 'them'} when you’re online.`}
              </p>
            )}
            {shown.length ? (
              <ul className="wr-list">
                {shown.map((w) => (
                  <WalkRow
                    key={w.id}
                    walk={w}
                    onOpen={() => onOpen(w)}
                    onRetry={() => onRetry(w.id)}
                    onDelete={() => setDeleting({ walk: w, busy: false, problem: null })}
                  />
                ))}
              </ul>
            ) : (
              <div className="ob-empty">
                <EmptyState icon="inbox" title={EMPTY[tab]} />
              </div>
            )}
          </section>
        </div>
      )}
      {deleting && (
        <DeleteWalkDialog
          walk={deleting.walk}
          busy={deleting.busy}
          problem={deleting.problem}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
