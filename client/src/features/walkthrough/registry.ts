// Every walkthrough definition in the app, and its Settings groups (F-12).
// Convention: each `features/**/*walkthroughs.ts` file (e.g. assessments/capture.walkthroughs.ts)
// exports `WALKTHROUGHS: WalkthroughDef[]`. Order comes from ORDER below, never from file order.
// Read by engine.ts and the Settings "Walkthroughs" section.
import type { UserRole } from '../accounts/api'
import type { WalkthroughDef } from './types'

// Group order, then the order within each group: as in .local-docs/specs/sprint-6/F-12/walkthroughs.json.
export const GROUPS = [
  'Getting started',
  'Setting up an assessment',
  'Capturing on site',
  'Writing the report',
  'Day to day',
  'Admin tasks',
] as const
const ORDER = [
  'welcome',
  'assessments',
  'new-choice',
  'new-form',
  'new-docs',
  'overview',
  'checklist',
  'observations',
  'new-observation',
  'split-note',
  'site-walk',
  'proposal',
  'proposals-list',
  'generation',
  'review',
  'review-ofi',
  'review-scores',
  'ask',
  'document',
  'versions',
  'export',
  'inbox',
  'calendar',
  'clients',
  'client-page',
  'insights',
  'chat',
  'kb-engineer',
  'usage',
  'settings',
  'admin-view',
  'kb-admin',
  'kb-add',
  'kb-review',
  'kb-requests',
  'accounts',
]

// Eager glob: Vite inlines every matching file at build time. `*walkthroughs.ts` never matches a
// `.test.ts` file, so test-only definitions stay out of the bundle.
const files = import.meta.glob<{ WALKTHROUGHS?: WalkthroughDef[] }>('../**/*walkthroughs.ts', {
  eager: true,
})
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length)

/** Every definition, in Settings and queue order. */
export const DEFINITIONS: WalkthroughDef[] = Object.values(files)
  .flatMap((file) => file.WALKTHROUGHS ?? [])
  .sort((a, b) => rank(a.id) - rank(b.id))

/** Returns the Settings groups, in order, with the walkthroughs this role can play. */
export function groupsFor(
  role: UserRole,
  definitions: WalkthroughDef[] = DEFINITIONS,
): { name: string; items: { id: string; name: string }[] }[] {
  return GROUPS.map((name) => ({
    name,
    items: definitions
      .filter((def) => def.group === name && def.roles.includes(role))
      .map(({ id, name: label }) => ({ id, name: label })),
  })).filter((group) => group.items.length > 0)
}
