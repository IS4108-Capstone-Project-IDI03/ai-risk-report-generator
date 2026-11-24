// The three tags an observation can carry (CP-36): Fact, Info request, Recommendation.
// Used by components/KindPicker.tsx and components/KindBadges.tsx. Untagged means Fact.
import type { Kind } from './api'

export const KINDS: Kind[] = ['fact', 'info_request', 'recommendation']
export const KIND_LABEL: Record<Kind, string> = {
  fact: 'Fact',
  info_request: 'Info request',
  recommendation: 'Recommendation',
}

/** Returns the tags in the picker's fixed order, so two orders of the same choice compare equal. */
export const sortKinds = (kinds: readonly Kind[]): Kind[] => KINDS.filter((k) => kinds.includes(k))
