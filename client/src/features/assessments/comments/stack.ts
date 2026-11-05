// Where each thread's card goes in the margin (RV-03 AC1): level with its
// passage where there is room, else pushed down below the card before it.
// The card being looked at stays level with its passage, and the cards
// above it move up to make room, as in Google Docs.

export type MarginItem = { id: string; top: number; height: number }

export const CARD_GAP = 8

export function stack(
  items: MarginItem[],
  active: string | null,
  gap = CARD_GAP,
): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.top - b.top)
  const at = active ? sorted.findIndex((i) => i.id === active) : -1
  const tops: Record<string, number> = {}
  if (at === -1) {
    let floor = 0
    for (const item of sorted) {
      const top = Math.max(item.top, floor)
      tops[item.id] = top
      floor = top + item.height + gap
    }
    return tops
  }
  const pinned = sorted[at]
  tops[pinned.id] = Math.max(0, pinned.top)
  let floor = tops[pinned.id] + pinned.height + gap
  for (const item of sorted.slice(at + 1)) {
    const top = Math.max(item.top, floor)
    tops[item.id] = top
    floor = top + item.height + gap
  }
  let ceiling = tops[pinned.id] - gap
  for (const item of sorted.slice(0, at).reverse()) {
    const top = Math.min(item.top, ceiling - item.height)
    tops[item.id] = top
    ceiling = top - gap
  }
  // No room above it: every card from the top instead.
  if (sorted.length && tops[sorted[0].id] < 0) return stack(items, null, gap)
  return tops
}
