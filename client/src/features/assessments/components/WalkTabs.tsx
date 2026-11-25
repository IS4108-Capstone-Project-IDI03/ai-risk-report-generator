// The Site Walk Proposals tab bar (CP-22 round 4, v2 in CP-24): Ready to review, In progress
// and Added across the top of the list, as the design system's Tabs with a count each.
// Rendered by screens/SiteWalks.tsx.
import { Tabs } from '../../../design-system'

export type WalkTab = 'ready' | 'working' | 'added'

// `short`: the name on a phone, where all three must fit on one line.
// `walk`: the tab's tag for the "Find your site walks" walkthrough (F-12).
export const WALK_TABS: {
  tab: WalkTab
  label: string
  short: string
  icon: string
  walk: string
}[] = [
  {
    tab: 'ready',
    label: 'Ready to review',
    short: 'Ready',
    icon: 'inbox',
    walk: 'proposals.tab.ready',
  },
  {
    tab: 'working',
    label: 'In progress',
    short: 'In progress',
    icon: 'clock',
    walk: 'proposals.tab.working',
  },
  {
    tab: 'added',
    label: 'Added',
    short: 'Added',
    icon: 'circle-check',
    walk: 'proposals.tab.added',
  },
]

// Shows the three groups with their counts; the nav keeps the screen known as "Site walk proposals".
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
      <Tabs
        items={WALK_TABS.map((t) => ({
          value: t.tab,
          label: t.label,
          shortLabel: t.short,
          icon: t.icon,
          count: counts[t.tab],
          walk: t.walk,
        }))}
        value={tab}
        onChange={(value) => onPick(value as WalkTab)}
        style={{ borderBottom: 'none' }}
      />
    </nav>
  )
}
