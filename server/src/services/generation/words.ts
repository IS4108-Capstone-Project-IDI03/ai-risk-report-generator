// How background drafting (GN-13) names a list of parts in words, for the bell
// (drafting-run.service.ts) and MarshBot (assistant/thread/topics-drafting.ts).
// must match client/src/features/assessments/generation/words.ts

/**
 * Returns parts as words in numeric order. Up to 2 runs of neighbours, each one
 * number or 3 and more, with at least one of 3 and more, read as ranges:
 * "Section 3 and Sections 6 to 12". Anything else is the plain numbers:
 * "Section 3", "Sections 4 and 5", "Sections 2, 4 and 5".
 */
export function sectionList(ids: string[]): string {
  const numbers = [...new Set(ids.map(Number))].sort((a, b) => a - b)
  // a. Runs of neighbours: 6, 7, 8 is one run.
  const runs: number[][] = []
  for (const n of numbers) {
    const last = runs.at(-1)
    if (last && n === last.at(-1)! + 1) last.push(n)
    else runs.push([n])
  }
  // b. Ranges only when every run reads well as one: never "Sections 4 to 5".
  const ranges =
    runs.length <= 2 &&
    runs.every((r) => r.length === 1 || r.length >= 3) &&
    runs.some((r) => r.length >= 3)
  if (ranges)
    return runs
      .map((r) => (r.length === 1 ? `Section ${r[0]}` : `Sections ${r[0]} to ${r.at(-1)}`))
      .join(' and ')
  // c. The plain numbers.
  if (numbers.length === 1) return `Section ${numbers[0]}`
  return `Sections ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`
}
