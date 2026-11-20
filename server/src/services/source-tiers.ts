// RT-04: the four authority tiers sources are ranked by, and the rule that suggests a tier
// from a knowledge document's source type. Used by settings.service.ts, knowledge-document.service.ts
// and rag.service.ts. The ids must match microservices/rag-service (tier_order in /chat).
import type { SourceType } from '../models/knowledge-document.model'

export const TIER_IDS = [
  'national_code',
  'manufacturer_rating',
  'marsh_precedent',
  'international_standard',
] as const
export type TierId = (typeof TIER_IDS)[number]

// Highest authority first.
export const DEFAULT_TIER_ORDER: readonly TierId[] = TIER_IDS

export const TIER_LABELS: Record<TierId, string> = {
  national_code: 'National code',
  manufacturer_rating: 'Manufacturer rating',
  marsh_precedent: 'Marsh precedent',
  international_standard: 'International standard',
}

const SUGGESTED: Record<SourceType, TierId> = {
  local_standard: 'national_code',
  fm_standard: 'manufacturer_rating',
  marsh_report: 'marsh_precedent',
  nfpa_standard: 'international_standard',
}

/** Returns the tier the rule suggests for a source type, or null when the type is unknown. */
export function suggestTier(sourceType: string | null | undefined): TierId | null {
  return SUGGESTED[sourceType as SourceType] ?? null
}

/** Returns true when `value` is a TierId. */
export function isTierId(value: unknown): value is TierId {
  return (TIER_IDS as readonly unknown[]).includes(value)
}
