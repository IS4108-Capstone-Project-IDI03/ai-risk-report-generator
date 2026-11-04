// The New Assessment form's data (CP-23): a new or recorded client, its
// sites, each with its assessments, plus the documents and their tags. Pure
// helpers only. Called by useNewAssessment.ts and the screen's components.
import type { AssessmentType } from '../../design-system'
import type { Assessment, ClientSite } from '../assessments/api'
import type { IntakeResult, NewAssessments, Placement, VisitType } from './api'

// One line on each assessment type, for the (?) beside the type control (AC18).
export const TYPE_HELP: { value: AssessmentType; help: string }[] = [
  { value: 'First survey', help: 'Our first survey of this site.' },
  { value: 'Resurvey', help: 'A periodic survey of a site we surveyed before.' },
  { value: 'Follow-up', help: 'A short check on an earlier survey’s recommendations.' },
]
// The gateway still stores Follow-up as "Follow-up visit" (server
// models/assessment.model.ts VISIT_TYPES); the screen never shows that word.
const toApi = (t: AssessmentType): VisitType => (t === 'Follow-up' ? 'Follow-up visit' : t)
const fromApi = (t: string | null) => (t === 'Follow-up visit' ? 'Follow-up' : (t ?? ''))
// The site choice for adding one the client doesn't have yet.
export const NEW_SITE = 'new'

export type Contact = { name: string; role: string }
// notSure lists the fields the AI left empty; editing a field drops its mark.
export type FormAssessment = {
  ref: string
  notSure: string[]
  visitType: AssessmentType | ''
  siteVisitDate: string
  siteVisitEndDate: string
  reportDueDate: string
  siteContacts: Contact[]
}
export type FormSite = {
  ref: string
  notSure: string[]
  // '' for a new client's site, NEW_SITE, or one of a recorded client's sites.
  choice: string
  copyLocations: boolean
  name: string
  address: string
  jurisdiction: string
  facilityType: string
  assessments: FormAssessment[]
}
export type FormClient = { id: string; name: string; division: string; notSure: string[] }
// A document read from the intake (fileId is the intake's), or added by hand
// on this form (file set; uploaded only after Create, so leaving keeps nothing).
export type FormDocument = {
  fileId: string
  name: string
  size: number
  placement: Placement
  notSure: boolean
  file?: File
}
export type ClientMode = 'new' | 'existing'
export type Form = {
  clientMode: ClientMode
  client: FormClient
  sites: FormSite[]
  documents: FormDocument[]
}

let refs = 0
const nextRef = (kind: string) => `${kind}-new-${++refs}`
// A new assessment's report is due this many days after its survey starts.
const REPORT_DUE_DAYS = 14
const day = (d = new Date()) => d.toLocaleDateString('en-CA')
function addDays(isoDay: string, days: number) {
  const d = new Date(isoDay + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return day(d)
}

/** Returns an assessment starting today, its report due two weeks later. */
export function blankAssessment(): FormAssessment {
  const today = day()
  return {
    ref: nextRef('a'),
    notSure: [],
    visitType: '',
    siteVisitDate: today,
    siteVisitEndDate: '',
    reportDueDate: addDays(today, REPORT_DUE_DAYS),
    siteContacts: [],
  }
}
/** Returns an empty site with one assessment. */
export function blankSite(choice = ''): FormSite {
  return {
    ref: nextRef('site'),
    notSure: [],
    choice,
    copyLocations: true,
    name: '',
    address: '',
    jurisdiction: 'SG',
    facilityType: '',
    assessments: [blankAssessment()],
  }
}
/** Returns the form as it opens, optionally on a recorded client and site. */
export function blankForm(start?: { clientId?: string; clientName?: string; siteId?: string }) {
  const existing = !!start?.clientId
  return {
    clientMode: existing ? 'existing' : 'new',
    client: { id: start?.clientId ?? '', name: start?.clientName ?? '', division: '', notSure: [] },
    // A recorded client starts with no site ticked, unless one was named.
    sites: existing ? (start?.siteId ? [blankSite(start.siteId)] : []) : [blankSite()],
    documents: [],
  } satisfies Form
}

// Splits AI fields into values, and the keys left empty (Not sure, AC8).
function fill<K extends string>(fields: Record<K, { value: string | null }>) {
  const values = {} as Record<K, string>
  const notSure: string[] = []
  for (const key of Object.keys(fields) as K[]) {
    values[key] = fields[key].value ?? ''
    if (fields[key].value === null) notSure.push(key)
  }
  return { values, notSure }
}

/** Returns the form filled in from the AI's reading of the intake documents. */
export function formFromResult(
  r: IntakeResult,
  files: Record<string, { name: string; size: number }>,
): Form {
  const client = fill({ name: r.client.name, division: r.client.division })
  const existing = !!r.client.existingId
  return {
    clientMode: existing ? 'existing' : 'new',
    // A matched client or site is used as recorded, so its fields need no look.
    client: {
      ...client.values,
      id: r.client.existingId ?? '',
      notSure: existing ? [] : client.notSure,
    },
    sites: r.sites.map((s) => {
      const site = fill({
        name: s.name,
        address: s.address,
        jurisdiction: s.jurisdiction,
        facilityType: s.facilityType,
      })
      return {
        ...site.values,
        notSure: s.existingId ? [] : site.notSure,
        ref: s.ref,
        choice: s.existingId ?? (existing ? NEW_SITE : ''),
        copyLocations: true,
        assessments: r.assessments
          .filter((a) => a.siteRef === s.ref)
          .map((a) => {
            const visit = fill({
              siteVisitDate: a.siteVisitDate,
              siteVisitEndDate: a.siteVisitEndDate,
              reportDueDate: a.reportDueDate,
            })
            return {
              ...visit.values,
              ref: a.ref,
              visitType: fromApi(a.visitType.value) as AssessmentType | '',
              notSure: [...visit.notSure, ...(a.visitType.value ? [] : ['visitType'])],
              siteContacts: a.siteContacts.map((c) => ({ name: c.name, role: c.role ?? '' })),
            }
          }),
      }
    }),
    // Documents that named no site still open on one empty site to fill in.
    ...(!r.sites.length && { sites: [blankSite(existing ? NEW_SITE : '')] }),
    documents: r.documents.map((d) => ({
      ...d,
      name: files[d.fileId]?.name ?? d.fileId,
      size: files[d.fileId]?.size ?? 0,
    })),
  }
}

// A site is new when the client is new or "New site" was added.
export const isNewSite = (form: Form, site: FormSite) =>
  form.clientMode === 'new' || site.choice === NEW_SITE

/** Returns whether an assessment can only be a First survey (AC20). */
export function firstSurveyOnly(form: Form, site: FormSite, index: number, sites?: ClientSite[]) {
  if (index > 0) return false
  if (isNewSite(form, site)) return true
  // A listed site whose visits are unknown (not loaded, or the call failed) is not forced.
  const listed = sites?.find((x) => x.id === site.choice)
  return !!listed && !listed.latest
}

/** Returns the type an assessment will be created as; '' while none is chosen. */
export const typeOf = (form: Form, site: FormSite, j: number, sites?: ClientSite[]) =>
  firstSurveyOnly(form, site, j, sites) ? 'First survey' : site.assessments[j].visitType

// Locations are copied only into a resurvey or follow-up of a recorded site.
const copies = (form: Form, site: FormSite, sites?: ClientSite[]) =>
  site.assessments.some((_, j) => {
    const t = typeOf(form, site, j, sites)
    return t === 'Resurvey' || t === 'Follow-up'
  })

/** Returns the index of the assessment that shows the copy-locations switch, or -1. */
export function copyAt(form: Form, site: FormSite, sites?: ClientSite[]) {
  if (isNewSite(form, site)) return -1
  if (!sites?.find((x) => x.id === site.choice)?.latest?.locations) return -1
  return site.assessments.findIndex((_, j) => {
    const t = typeOf(form, site, j, sites)
    return t === 'Resurvey' || t === 'Follow-up'
  })
}

/** Returns the name a site is shown by: as recorded, as typed, or "Site N". */
export function siteLabel(form: Form, i: number, sites?: ClientSite[]) {
  const s = form.sites[i]
  return sites?.find((x) => x.id === s.choice)?.name || s.name.trim() || 'Site ' + (i + 1)
}

/** Returns every tag a document can take: Whole client, each site, each assessment. */
export function tagOptions(form: Form, sites?: ClientSite[]) {
  return [
    { value: 'client', label: 'Whole client', group: 'client' as const },
    ...form.sites.map((s, i) => ({
      value: 'site:' + s.ref,
      label: siteLabel(form, i, sites),
      group: 'site' as const,
    })),
    ...form.sites.flatMap((s, i) =>
      s.assessments.map((a, j) => ({
        value: 'assessment:' + a.ref,
        label:
          siteLabel(form, i, sites) +
          ' · ' +
          (typeOf(form, s, j, sites) || 'Assessment ' + (j + 1)),
        group: 'assessment' as const,
      })),
    ),
  ]
}
/** Returns a placement's TagPicker value. */
export const tagOf = (p: Placement) => (p.kind === 'client' ? 'client' : p.kind + ':' + p.ref)
/** Returns the placement a TagPicker value stands for. */
export function placementOf(tag: string): Placement {
  if (tag === 'client') return { kind: 'client' }
  const [kind, ref] = tag.split(':') as ['site' | 'assessment', string]
  return { kind, ref }
}

const optional = (value: string) => value.trim() || undefined
/** Returns the request body the gateway's create routes take. */
export function toBody(form: Form, sitesOf?: ClientSite[]): NewAssessments {
  const { client } = form
  return {
    client:
      form.clientMode === 'existing'
        ? { id: client.id }
        : { name: client.name.trim(), division: optional(client.division) },
    sites: form.sites.map((s) => ({
      ref: s.ref,
      ...(isNewSite(form, s)
        ? {
            name: s.name.trim(),
            address: s.address.trim(),
            jurisdiction: s.jurisdiction,
            facilityType: s.facilityType,
          }
        : { id: s.choice, copyLocations: s.copyLocations && copies(form, s, sitesOf) }),
      assessments: s.assessments.map((a, j) => ({
        ref: a.ref,
        visitType: toApi(typeOf(form, s, j, sitesOf) as AssessmentType),
        siteVisitDate: optional(a.siteVisitDate),
        siteVisitEndDate: optional(a.siteVisitEndDate),
        reportDueDate: optional(a.reportDueDate),
        siteContacts: a.siteContacts
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), role: optional(c.role) })),
      })),
    })),
  }
}

/**
 * Returns each hand-added document's placement with real ids, once created:
 * the gateway answers the assessments in request order (assessment-batch.service.ts).
 */
export function keptPlacement(form: Form, created: Assessment[], p: Placement) {
  if (p.kind === 'client') return { kind: 'client' as const }
  const refs = form.sites.flatMap((s) => s.assessments.map((a) => ({ site: s.ref, a: a.ref })))
  const k = refs.findIndex((r) => (p.kind === 'site' ? r.site : r.a) === p.ref)
  const made = created[k]
  if (!made) return { kind: 'client' as const }
  return p.kind === 'site'
    ? { kind: 'site' as const, siteId: made.site.id }
    : { kind: 'assessment' as const, assessmentId: made.id }
}

/** Returns how many documents are tagged to a site or one of its assessments. */
export const docsOn = (form: Form, site: FormSite) =>
  form.documents.filter(
    (d) =>
      d.placement.kind !== 'client' &&
      [site.ref, ...site.assessments.map((a) => a.ref)].includes(d.placement.ref),
  ).length
