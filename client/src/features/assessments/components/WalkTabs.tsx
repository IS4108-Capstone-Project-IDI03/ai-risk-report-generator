// The Site Walk Proposals tab bar (CP-22 round 4): Ready to review, In progress
// and Added across the top of the list, so the list gets the
// full width. Each count keeps its own colour whichever tab is picked: blue
// to review, amber in progress, green added. Rendered by screens/SiteWalks.tsx.
import { Icon } from '../../../design-system'

export type WalkTab = 'ready' | 'working' | 'added'

// `short`: the name on a phone, where all three must fit on one line.
export const WALK_TABS: { tab: WalkTab; label: string; short: string; icon: string }[] = [
  { tab: 'ready', label: 'Ready to review', short: 'Ready', icon: 'inbox' },
  { tab: 'working', label: 'In progress', short: 'In progress', icon: 'clock' },
  { tab: 'added', label: 'Added', short: 'Added', icon: 'circle-check' },
]

export function WalkTabs({
  tab,
  counts,
  onPick,
}: {
  tab: WalkTab
  counts: Record<WalkTab, number>
  onPick: (tab: WalkTab) => void
}) {
  return (
    <nav className="wr-tabs" aria-label="Site walk proposals">
      {WALK_TABS.map((t) => (
        <button
          key={t.tab}
          type="button"
          className="wr-tab"
          data-tab={t.tab}
          aria-current={tab === t.tab || undefined}
          onClick={() => onPick(t.tab)}
        >
          <span className="wr-tab-icon">
            <Icon name={t.icon} size={16} />
          </span>
          <span className="wr-tab-label">{t.label}</span>
          <span className="wr-tab-short">{t.short}</span>
          <span className="wr-count">{counts[t.tab]}</span>
        </button>
      ))}
    </nav>
  )
}
