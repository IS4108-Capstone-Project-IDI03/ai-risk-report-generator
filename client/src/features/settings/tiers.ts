// The four source tiers and their names (RT-04). Used by the Source priority
// section (screens/SourcePrioritySection.tsx) and the knowledge base's tier field.
// Ids must match the server's tier ids (RT-04 contract).
export type TierId =
  'national_code' | 'manufacturer_rating' | 'marsh_precedent' | 'international_standard'

/** The tiers in their default order, highest authority first. */
export const TIER_IDS: TierId[] = [
  'national_code',
  'manufacturer_rating',
  'marsh_precedent',
  'international_standard',
]

export const TIER_LABELS: Record<TierId, string> = {
  national_code: 'National code',
  manufacturer_rating: 'Manufacturer rating',
  marsh_precedent: 'Marsh precedent',
  international_standard: 'International standard',
}

/** One icon per source type (lucide names), so a tier can be told apart at a glance. */
export const TIER_ICONS: Record<TierId, string> = {
  national_code: 'landmark',
  manufacturer_rating: 'factory',
  marsh_precedent: 'briefcase',
  international_standard: 'globe',
}

/** Returns an order as plain words, e.g. "National code, Marsh precedent". */
export const describeOrder = (order: TierId[]) => order.map((t) => TIER_LABELS[t]).join(', ')

/** Returns the order with the item at `from` moved to `to`; the same order if either is out of range. */
export function move(order: TierId[], from: number, to: number): TierId[] {
  if (from === to || to < 0 || to >= order.length || from < 0 || from >= order.length) return order
  const next = [...order]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}
