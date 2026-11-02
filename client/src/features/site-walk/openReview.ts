// Opens a site walk's Review from outside the Observations tab (CP-22): the
// "site walk ready" notification. Read by assessments/AssessmentApp.tsx (opens
// the assessment) and screens/Observations.tsx (opens the review).
// Kept outside React so Observations, mounted after the click, still finds it.
export const siteWalkReview = {
  walkId: null as string | null,
  // The observation to open on arrival: the one the Add manually screen just added.
  observationRef: null as string | null,
  event: 'site-walk-review',
}

/** Asks the app to open `reference`'s Observations tab on walk `walkId`'s review. */
// Opens this walk’s proposal from its notification.
export function openSiteWalkReview(reference: string, walkId: string) {
  siteWalkReview.walkId = walkId
  window.dispatchEvent(new CustomEvent(siteWalkReview.event, { detail: { reference, walkId } }))
}
