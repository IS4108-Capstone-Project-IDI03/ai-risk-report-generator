// A MarshBot card's tone as the shared IconTile's (design system): its rows and checklist groups.
// Called by CardRow and ChecklistCard.
import type { IconTileTone } from '../../../../design-system'

const TONES: Record<string, IconTileTone> = {
  violet: 'violet',
  amber: 'warn',
  red: 'danger',
  green: 'good',
}

/** Returns the IconTile tone for a card tone; anything else is neutral grey. */
export const tileTone = (tone: string) => TONES[tone] ?? 'neutral'
