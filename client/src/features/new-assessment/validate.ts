// Checks the New Assessment form before Create (CP-23 AC19): each missing or
// wrong field gets one short line, shown under it. Keys are the gateway's
// field paths, e.g. "sites.0.assessments.1.visitType" (must match its 400
// `fields`). Called by useNewAssessment.ts.
import type { ClientSite } from '../assessments/api'
import { parseCoordinates } from '../assessments/googleMaps'
import { sameName } from '../assessments/locations'
import { firstSurveyOnly, isNewSite, type Form } from './form'

/** Returns the line for a date before the survey start (dd/mm/yyyy, as the form shows dates). */
export const beforeStartLine = (start: string) =>
  `Pick a date on or after ${start.split('-').reverse().join('/')}, the survey start.`

/** The line for a date field whose typed text is not a real date. */
export const INVALID_DATE = 'Enter a date as dd/mm/yyyy'

/** Returns each problem by field path; `typed` holds the date paths whose text is not a date. */
export function validate(
  form: Form,
  clientName: string,
  sitesOf?: ClientSite[],
  typed: ReadonlySet<string> = new Set(),
) {
  const errors: Record<string, string> = {}
  if (form.clientMode === 'new' && !form.client.name.trim())
    errors['client.name'] = 'Add the client name'
  if (form.clientMode === 'existing' && !form.client.id) errors['client.id'] = 'Choose a client'
  else if (!form.sites.length) errors['sites'] = 'Choose a site, or add a new one'
  form.sites.forEach((site, i) => {
    const at = `sites.${i}.`
    if (isNewSite(form, site)) {
      const taken = sitesOf?.find((x) => sameName(x.name, site.name))
      if (!site.name.trim()) errors[at + 'name'] = 'Add the site name'
      else if (taken) errors[at + 'name'] = clientName + ' already has ' + taken.name
      // The gateway refuses two new sites with one name in a request.
      else if (
        form.sites.slice(0, i).some((x) => isNewSite(form, x) && sameName(x.name, site.name))
      )
        errors[at + 'name'] = 'Another new site has this name'
      if (!site.jurisdiction) errors[at + 'jurisdiction'] = 'Choose a jurisdiction'
      if (!site.facilityType) errors[at + 'facilityType'] = 'Choose a facility type'
      if (!site.address.trim()) errors[at + 'address'] = 'Add the address'
      if (site.coordinates.trim() && !parseCoordinates(site.coordinates))
        errors[at + 'coordinates'] = 'Enter coordinates such as 1.2966, 103.8520'
    }
    site.assessments.forEach((a, j) => {
      const field = `${at}assessments.${j}.`
      if (!a.visitType && !firstSurveyOnly(form, site, j, sitesOf))
        errors[field + 'visitType'] = 'Choose an assessment type'
      if (!a.siteVisitDate) errors[field + 'siteVisitDate'] = 'Add the survey start'
      if (a.siteVisitEndDate && a.siteVisitDate && a.siteVisitEndDate < a.siteVisitDate)
        errors[field + 'siteVisitEndDate'] = beforeStartLine(a.siteVisitDate)
      if (a.reportDueDate && a.siteVisitDate && a.reportDueDate < a.siteVisitDate)
        errors[field + 'reportDueDate'] = beforeStartLine(a.siteVisitDate)
    })
  })
  // A date typed wrongly reads as empty above; say what is wrong with it instead.
  typed.forEach((path) => {
    errors[path] = INVALID_DATE
  })
  return errors
}
