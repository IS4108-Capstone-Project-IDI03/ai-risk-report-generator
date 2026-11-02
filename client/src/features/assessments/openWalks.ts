// Which site walks the Observations tab still shows (CP-22 AC5): every walk not
// yet turned into observations. Used by screens/Observations.tsx.
import type { SiteWalk } from '../site-walk'

const OPEN = ['recording', 'transcribing', 'proposing', 'ready', 'failed'] as const
export type OpenStatus = (typeof OPEN)[number]

/** Returns the walks that still need something, newest first. */
export function openWalks(walks: SiteWalk[]) {
  return walks
    .filter((w) => (OPEN as readonly string[]).includes(w.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
