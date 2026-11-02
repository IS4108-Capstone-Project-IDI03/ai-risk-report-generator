// Words for a walk on the Site Walk Proposals list (CP-22 round 3): its name,
// its status (for screen readers; the screen shows an icon) and what failed.
// Used by components/WalkRow.tsx and screens/Review.tsx.
import type { SiteWalk } from './api'

export const STATUS = {
  recording: 'Recording',
  transcribing: 'Transcribing',
  proposing: 'Reading your walk',
  ready: 'Ready to review',
  failed: 'Couldn’t finish',
  created: 'Added to the assessment',
} as const

/**
 * Returns a walk's name: the one the engineer gave it, else (older walks) the
 * places it went, in the order spoken ("Service corridor · Loading bay", "+2"
 * past two), or "Site walk" before any are known.
 */
export function walkName(walk: SiteWalk) {
  if (walk.name?.trim()) return walk.name.trim()
  const places = [...new Set((walk.proposal?.locations ?? []).map((l) => l.name))]
  if (!places.length) return 'Site walk'
  const more = places.length > 2 ? ` +${places.length - 2}` : ''
  return places.slice(0, 2).join(' · ') + more
}

/** Returns when the walk was recorded: "Mon 2 Nov, 11:36". */
export const walkWhen = (walk: SiteWalk) =>
  new Date(walk.createdAt).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

// Why a failed walk failed; the gateway stores a plain sentence, this covers an empty one.
export const walkProblem = (walk: SiteWalk) =>
  walk.error ?? 'Couldn’t read the walk. Retry to try again.'
