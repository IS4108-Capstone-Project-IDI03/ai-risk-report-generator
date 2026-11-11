// Shared helpers for MarshBot's checks (AS-06): a short fingerprint, and an
// item with its defaults filled in. Called by every file in checks/.
import { createHash } from 'node:crypto'
import type { BriefItem } from './types'

/** Returns a short fingerprint of any JSON value; equal values give equal fingerprints. */
export function fingerprintOf(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

// What a check returns: an item before the merge gives it its times.
export type RaisedItem = Omit<BriefItem, 'firstSeenAt' | 'resolvedAt'>

type ItemInput = Pick<
  BriefItem,
  'id' | 'kind' | 'stage' | 'weight' | 'title' | 'fact' | 'icon' | 'facts'
> &
  Partial<Pick<BriefItem, 'detail' | 'link' | 'action' | 'actionTarget'>>

/** Returns the item with empty optional fields, its fingerprint, and dismissible unless Fix now. */
export function raise(input: ItemInput): RaisedItem {
  return {
    detail: null,
    link: null,
    action: null,
    actionTarget: null,
    ...input,
    fingerprint: fingerprintOf(input.facts),
    dismissible: input.weight !== 'fix_now',
  }
}

/** Returns "1 observation" or "3 observations". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

/** Returns "A", "A and B", or "A, B and C". */
export function listed(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '')
}
