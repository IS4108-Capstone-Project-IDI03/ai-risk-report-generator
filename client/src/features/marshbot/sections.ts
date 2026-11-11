// How a report section's review state looks, shared by the outline and the admin lanes (AS-06
// boards 02 and 07). Used by components/ReportOutline.tsx and components/StatusLanes.tsx.
import type { SectionState } from './types'

// One icon and word per state, said once in the key (board 14: no status word on every row).
export const SECTION_LOOK: Record<SectionState['state'], { icon: string; word: string }> = {
  reviewed: { icon: 'circle-check', word: 'Reviewed' },
  decisions: { icon: 'circle-alert', word: 'Decisions to make' },
  not_started: { icon: 'circle-dashed', word: 'Not started' },
}

/** Returns the sections in report order (by number). */
export const inOrder = (sections: SectionState[]) =>
  [...sections].sort((a, b) => Number(a.sectionId) - Number(b.sectionId))
