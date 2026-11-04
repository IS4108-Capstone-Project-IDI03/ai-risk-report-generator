// Builds POST /api/assessments' body (CP-23) for one site with one assessment,
// from the flat fields the CP-17 and CP-18 tests were written with: a client
// by name or id, a new site or a listed one, and the visit's details.
type Flat = {
  client?: string
  clientId?: string
  division?: string
  site?: Record<string, unknown>
  siteId?: string
  copyLocations?: boolean
  surveyType?: string
  siteVisitDate?: string
  siteVisitEndDate?: string
  reportDueDate?: string
  siteContacts?: { name: string; role?: string }[]
}

export function oneAssessment({
  client,
  clientId,
  division,
  site,
  siteId,
  copyLocations,
  surveyType = 'First survey',
  ...visit
}: Flat) {
  return {
    client: clientId !== undefined ? { id: clientId } : { name: client, division },
    sites: [
      {
        ref: 'site-1',
        ...(siteId !== undefined ? { id: siteId, copyLocations } : site),
        assessments: [{ ref: 'a-1', visitType: surveyType, ...visit }],
      },
    ],
  }
}
