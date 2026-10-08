// Rules for the details form in the Edit details dialog (KB-01, IN-05).
// Called by components/DetailsFields.tsx and components/EditDetailsDialog.tsx.
import type { DocumentDetails, SourceType } from './api'

// Stands for "not chosen yet" in a standard's facility type, where '' already
// means "All facility types". Never sent to the gateway.
export const FACILITY_UNSET = 'unset'

// Returns the details with the new source type and that type's defaults.
// Changing the source type starts that type's own fields afresh: a standard
// applies in all countries unless narrowed; a past report is about one site,
// most often in Singapore. Title and date suit both types, so they stay.
export function withSourceType(
  details: DocumentDetails,
  sourceType: SourceType | '',
): DocumentDetails {
  return {
    ...details,
    sourceType,
    edition: '',
    facilityType: '',
    jurisdiction: sourceType === 'marsh_report' ? 'SG' : sourceType ? 'all' : '',
  }
}

/**
 * Returns why a standard's edition is not acceptable, or null when it is.
 * It must be a year from 1900 to next year (a new edition can come out ahead
 * of the year it is named for); the gateway checks the same rule.
 */
export function editionProblem(details: DocumentDetails): string | null {
  if (details.sourceType !== 'fm_standard' && details.sourceType !== 'nfpa_standard') return null
  if (!details.edition) return 'Edition is required.'
  const nextYear = new Date().getFullYear() + 1
  const year = Number(details.edition)
  return /^\d{4}$/.test(details.edition) && year >= 1900 && year <= nextYear
    ? null
    : `Edition must be a year from 1900 to ${nextYear}.`
}
