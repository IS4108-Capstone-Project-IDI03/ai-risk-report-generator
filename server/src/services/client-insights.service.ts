// A client's Insights tab (CP-29): what its sites' observations, accepted OFIs
// and Section 4 scores add up to, which sites need attention and how each
// changed between visits. Counted and worded here by fixed rules; no model is
// asked. Called by routes/client.routes.ts and client-insight-summary.service.ts.
// See docs/areas/database.md, "Client insights".
import { isValidObjectId } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { COPE_DIMENSIONS } from '../models/observation.model'
import { SiteModel } from '../models/site.model'
import type { SessionUser } from './auth.service'
import { listAssessments, type AssessmentDto, type AssessmentStatus } from './assessment.service'
import { ClientSiteError } from './client.service'
import { locationText } from './location.service'
import { listObservationsOf, type ObservationDto } from './observation.service'
import { acceptedOfiPriorities } from './ofi.service'
import { rate } from './risk-quality.service'
import { handwritingOf, observationFacts, transcriptsOf } from './section.service'

// The rules below, named so a change to them can be told apart in a saved summary.
export const INSIGHTS_RULES = 'insights-v1'
// Fewer observations than this and no category is called the most common:
// a share of four observations says nothing.
const MIN_FOR_SHARE = 5
// The most the summary's model is given, most severe first.
const EVIDENCE_LIMIT = 60
const EVIDENCE_CHARS = 600

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Marsh's rating letters, worst first (risk-quality.service's legend).
const WORST_FIRST = ['E', 'D', 'C', 'B', 'A']
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low']

export type InsightTone = 'danger' | 'warn' | 'good' | 'neutral'

// One category's observations at a site; `category` null is not yet categorised.
export type InsightCell = {
  category: string | null
  count: number
  critical: number
  high: number
}

// One assessment of a site that has observations, as the change between
// visits reads it.
export type InsightVisit = {
  reference: string
  siteVisitDate: string | null
  surveyType: string
  observations: number
  criticalHigh: number
  ofis: number
  score: number | null
  rating: string | null
}

export type InsightSite = {
  id: string
  name: string
  facilityType: string
  jurisdiction: string
  // The assessment its figures come from: the latest with observations, or its
  // latest one while none has any.
  reference: string
  siteVisitDate: string | null
  status: AssessmentStatus
  observations: number
  critical: number
  high: number
  uncategorised: number
  cells: InsightCell[]
  ofis: { accepted: number; priority1: number; priority2: number }
  // Null until all seven Section 4 scores are entered: never a guess.
  rating: { score: number; rating: string } | null
  // Why it sits where it does in the list, most serious first.
  reasons: { text: string; tone: InsightTone }[]
  // Its assessments with observations, oldest first.
  visits: InsightVisit[]
  // Critical and High findings, first visit against latest; null with one visit.
  change: 'improved' | 'worse' | 'same' | null
}

export type InsightFinding = {
  kind: 'category' | 'worse' | 'improved' | 'severe'
  tone: InsightTone
  title: string
  detail: string
  // What it points at: a site, or a category of the grid.
  siteId: string | null
  category: string | null
  // A share ("21 of 50") or a change ("5 to 7"), for the card's figure.
  share: { count: number; total: number } | null
  change: { from: number; to: number; period: string | null } | null
}

export type ClientInsightsDto = {
  rulesVersion: string
  // No site has an observation yet: there is nothing to analyse.
  empty: boolean
  totals: {
    sites: number
    assessments: number
    observations: number
    uncategorised: number
    critical: number
    high: number
    ofisAccepted: number
    ofisPriority12: number
    reportsLate: number
    // The latest report, by days.
    latest: { site: string; days: number } | null
  }
  // The grid's columns, in C-O-P-E order, then not categorised (null).
  byCategory: InsightCell[]
  // Worst first: Critical findings, then Priority 1 OFIs, then rating.
  sites: InsightSite[]
  findings: InsightFinding[]
}

// What the summary's model is given (client-insight-summary.service.ts): the
// figures above as lines of text, and the observations they count.
export type InsightEvidence = {
  figures: { label: string; title: string; lines: string[] }[]
  observations: {
    label: string
    observationId: string
    reference: string
    site: string
    location: string | null
    severity: string
    categories: string[]
    date: string | null
    text: string
  }[]
  basis: { observations: number; ofis: number; ratings: number }
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const today = () => new Date().toISOString().slice(0, 10)
const monthOf = (day: string | null) =>
  day ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` : null
// Whether rating `a` is worse than `b`.
const worseRating = (a: string, b: string) => WORST_FIRST.indexOf(a) < WORST_FIRST.indexOf(b)

// An assessment's place in visit order: its visit day, or the day it was made.
const visitDay = (a: AssessmentDto) => a.siteVisitDate ?? a.createdAt.toISOString().slice(0, 10)
const oldestFirst = (a: AssessmentDto, b: AssessmentDto) =>
  visitDay(a).localeCompare(visitDay(b)) || a.createdAt.getTime() - b.createdAt.getTime()

type Counted = {
  assessment: AssessmentDto
  observations: ObservationDto[]
  cells: InsightCell[]
  critical: number
  high: number
  ofis: { accepted: number; priority1: number; priority2: number }
  rating: { score: number; rating: string } | null
}

const CATEGORIES: (string | null)[] = [...COPE_DIMENSIONS, null]

// One assessment's figures. An observation filed under two categories counts
// in both, so a row can add up to more than its observations.
function count(
  assessment: AssessmentDto,
  observations: ObservationDto[],
  priorities: string[],
  scores: Parameters<typeof rate>[0],
): Counted {
  const cells = CATEGORIES.map((category) => {
    const filed = observations.filter((o) => {
      const under: readonly string[] | null = o.copeDimensions
      return category ? !!under?.includes(category) : !under
    })
    return {
      category,
      count: filed.length,
      critical: filed.filter((o) => o.severity === 'critical').length,
      high: filed.filter((o) => o.severity === 'high').length,
    }
  })
  const current = rate(scores).current
  return {
    assessment,
    observations,
    cells,
    critical: observations.filter((o) => o.severity === 'critical').length,
    high: observations.filter((o) => o.severity === 'high').length,
    ofis: {
      accepted: priorities.length,
      priority1: priorities.filter((p) => p === 'Priority 1').length,
      priority2: priorities.filter((p) => p === 'Priority 2').length,
    },
    rating: current ? { score: current.score, rating: current.rating } : null,
  }
}

// How many days a report is late, or 0: one not finalised whose due day has passed.
function daysLate(a: AssessmentDto, day: string): number {
  if (a.status === 'finalised' || !a.reportDueDate || a.reportDueDate >= day) return 0
  return Math.round((Date.parse(day) - Date.parse(a.reportDueDate)) / 86_400_000)
}

function reasonsOf(site: Omit<InsightSite, 'reasons'>, late: number): InsightSite['reasons'] {
  const reasons: InsightSite['reasons'] = []
  const add = (text: string, tone: InsightTone) => reasons.push({ text, tone })
  if (site.critical) add(plural(site.critical, 'Critical finding'), 'danger')
  if (site.ofis.priority1) add(plural(site.ofis.priority1, 'Priority 1 OFI'), 'danger')
  if (late) add(`Report ${plural(late, 'day')} late`, 'danger')
  if (site.high) add(plural(site.high, 'High finding'), 'warn')
  if (site.uncategorised) add(`${site.uncategorised} uncategorised`, 'warn')
  if (site.rating) {
    const poor = site.rating.rating === 'D' || site.rating.rating === 'E'
    add(`Rated ${site.rating.rating}`, poor ? 'warn' : 'neutral')
  } else if (site.observations) add('Rating not entered', 'neutral')
  if (site.change === 'worse') add('Worse since first visit', 'warn')
  if (site.change === 'improved') add('Improved since first visit', 'good')
  if (!site.observations) add('No observations yet', 'neutral')
  return reasons
}

// Worst first: Critical findings, then Priority 1 OFIs, then the rating
// (unrated last), then Critical and High together, then by name.
function bySeverity(a: InsightSite, b: InsightSite): number {
  const band = (s: InsightSite) =>
    s.rating ? WORST_FIRST.length - WORST_FIRST.indexOf(s.rating.rating) : 0
  return (
    b.critical - a.critical ||
    b.ofis.priority1 - a.ofis.priority1 ||
    band(b) - band(a) ||
    b.critical + b.high - (a.critical + a.high) ||
    a.name.localeCompare(b.name)
  )
}

// How a site's rating or score moved between two visits, as the end of a sentence.
function ratingChange(first: InsightVisit, last: InsightVisit): string {
  if (first.rating && last.rating && first.rating !== last.rating) {
    const fell = worseRating(last.rating, first.rating)
    return `, and its rating ${fell ? 'fell' : 'rose'} from ${first.rating} to ${last.rating}.`
  }
  if (first.score !== null && last.score !== null && first.score !== last.score)
    return `, and its score ${last.score < first.score ? 'fell' : 'rose'} from ${first.score} to ${last.score}.`
  return '.'
}

function period(first: InsightVisit, last: InsightVisit): string | null {
  const from = monthOf(first.siteVisitDate)
  const to = monthOf(last.siteVisitDate)
  return from && to ? `${from} to ${to}` : null
}

// What stands out, at most three: the most common category, the site that got
// worse the most, the one that improved the most, and the site with the most
// severe findings when no change already names it.
function findingsOf(sites: InsightSite[], byCategory: InsightCell[]): InsightFinding[] {
  const found: InsightFinding[] = []
  const withObservations = sites.filter((s) => s.observations)
  const total = withObservations.reduce((n, s) => n + s.observations, 0)

  const ranked = byCategory.filter((c) => c.category).sort((a, b) => b.count - a.count)
  const [top, second] = ranked
  if (total >= MIN_FOR_SHARE && top && top.count > (second?.count ?? 0)) {
    const at = withObservations.filter(
      (s) => s.cells.find((c) => c.category === top.category)!.count > 0,
    ).length
    const where =
      at === withObservations.length
        ? at === 1
          ? 'its one site'
          : `all ${at} sites`
        : `${at} of ${withObservations.length} sites`
    found.push({
      kind: 'category',
      tone: 'neutral',
      title: `${top.category} is the most common category`,
      detail: `${top.count} of ${plural(total, 'observation')}, found at ${where}.`,
      siteId: null,
      category: top.category,
      share: { count: top.count, total },
      change: null,
    })
  }

  const changed = sites
    .filter((s) => s.visits.length > 1)
    .map((s) => {
      const first = s.visits[0]
      const last = s.visits[s.visits.length - 1]
      return { site: s, first, last, delta: last.criticalHigh - first.criticalHigh }
    })
  const moved = (kind: 'worse' | 'improved') => {
    const worse = kind === 'worse'
    const pick = changed
      .filter((c) => (worse ? c.delta > 0 : c.delta < 0))
      .sort((a, b) => (worse ? b.delta - a.delta : a.delta - b.delta))[0]
    if (!pick) return null
    found.push({
      kind,
      tone: worse ? 'danger' : 'good',
      title: `${pick.site.name} ${worse ? 'got worse' : 'improved'} between visits`,
      detail:
        `Critical and High findings ${worse ? 'rose' : 'fell'} from ${pick.first.criticalHigh} to ${pick.last.criticalHigh}` +
        ratingChange(pick.first, pick.last),
      siteId: pick.site.id,
      category: null,
      share: null,
      change: {
        from: pick.first.criticalHigh,
        to: pick.last.criticalHigh,
        period: period(pick.first, pick.last),
      },
    })
    return pick.site.id
  }
  const worse = moved('worse')
  moved('improved')

  const worst = sites[0]
  if (worst?.critical && worst.id !== worse) {
    found.push({
      kind: 'severe',
      tone: 'danger',
      title: `${worst.name} has the most severe findings`,
      detail:
        plural(worst.critical, 'Critical finding') +
        (worst.rating ? `, rated ${worst.rating.rating}.` : '.'),
      siteId: worst.id,
      category: null,
      share: null,
      change: null,
    })
  }
  return found.slice(0, 3)
}

// The text of an observation the engineer recorded: its note, then finished
// transcripts and handwritten pages, as drafting reads them (section.service).
function recorded(o: ObservationDto): string {
  return [observationFacts(o), ...transcriptsOf(o), ...handwritingOf(o)]
    .filter((t): t is string => !!t?.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// The figures as lines of text, and the latest assessments' observations, for
// the summary's model to cite. Labels (F1, O3) are how a statement names them.
function evidenceOf(
  sites: InsightSite[],
  byCategory: InsightCell[],
  current: Map<string, Counted>,
): InsightEvidence {
  const withObservations = sites.filter((s) => s.observations)
  const cellsText = (cells: InsightCell[]) =>
    cells
      .filter((c) => c.category || c.count)
      .map((c) => `${c.category ?? 'uncategorised'} ${c.count}`)
      .join(', ')
  const total = withObservations.reduce((n, s) => n + s.observations, 0)

  const figures: InsightEvidence['figures'] = [
    {
      label: 'F1',
      title: "Observations by category, at each site's latest assessment",
      lines: [
        `Across ${plural(withObservations.length, 'site')}: ${cellsText(byCategory)} (${plural(total, 'observation')}).`,
        ...withObservations.map(
          (s) =>
            `${s.name}: ${cellsText(s.cells)}; ${s.critical} Critical, ${s.high} High, of ${plural(s.observations, 'observation')}.`,
        ),
      ],
    },
    {
      label: 'F2',
      title: 'Risk quality rating and accepted OFIs, by site',
      lines: withObservations.map(
        (s) =>
          `${s.name}: ${s.rating ? `rated ${s.rating.rating} (${s.rating.score} of 100)` : 'not rated yet'}; ` +
          `${plural(s.ofis.accepted, 'accepted OFI')}, ${s.ofis.priority1} Priority 1, ${s.ofis.priority2} Priority 2.`,
      ),
    },
  ]
  const changes = sites
    .filter((s) => s.visits.length > 1)
    .map((s) => {
      const first = s.visits[0]
      const last = s.visits[s.visits.length - 1]
      const when = (v: InsightVisit) =>
        monthOf(v.siteVisitDate) ? ` (${monthOf(v.siteVisitDate)})` : ''
      return (
        `${s.name}: Critical and High findings ${first.criticalHigh}${when(first)} to ${last.criticalHigh}${when(last)}` +
        (first.score !== null && last.score !== null
          ? `; score ${first.score} to ${last.score}; rating ${first.rating} to ${last.rating}.`
          : '.')
      )
    })
  if (changes.length)
    figures.push({ label: 'F3', title: 'Change between first and latest visit', lines: changes })

  const observations = withObservations
    .flatMap((s) =>
      current
        .get(s.id)!
        .observations.map((o) => ({ site: s, o, text: recorded(o) }))
        .filter((e) => e.text),
    )
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.o.severity) - SEVERITY_ORDER.indexOf(b.o.severity) ||
        a.site.name.localeCompare(b.site.name),
    )
    .slice(0, EVIDENCE_LIMIT)
    .map(({ site, o, text }, i) => ({
      label: `O${i + 1}`,
      observationId: o.id,
      reference: site.reference,
      site: site.name,
      location: o.location ? locationText(o.location) : null,
      severity: o.severity,
      categories: o.copeDimensions ?? [],
      date: o.recordedAt.toISOString().slice(0, 10),
      text: text.length > EVIDENCE_CHARS ? text.slice(0, EVIDENCE_CHARS).trimEnd() + '…' : text,
    }))

  return {
    figures,
    observations,
    basis: {
      observations: total,
      ofis: withObservations.reduce((n, s) => n + s.ofis.accepted, 0),
      ratings: withObservations.filter((s) => s.rating).length,
    },
  }
}

/**
 * Returns a client's insights and the evidence a summary of them rests on.
 * Only someone with an assessment for the client may read them, and they are
 * counted from their own assessments (a knowledge admin's are everyone's), as
 * the client page lists them (CP-18). Archived assessments and removed sites
 * are left out. Throws ClientSiteError: 404 unknown, 403 no assessment there.
 */
export async function readClientInsights(
  id: string,
  user: SessionUser,
): Promise<{
  client: { id: string; name: string }
  insights: ClientInsightsDto
  evidence: InsightEvidence
}> {
  const client = isValidObjectId(id) ? await ClientModel.findById(id).lean() : null
  if (!client) throw new ClientSiteError('This client was not found.', 404)
  const all = await SiteModel.find({ client: client._id })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean()
  const ids = new Set(all.map((s) => String(s._id)))
  const mine = (await listAssessments(user)).filter((a) => ids.has(a.site.id))
  if (!mine.length) throw new ClientSiteError('You have no assessments for this client.', 403)

  const listed = all.filter((s) => !s.removed)
  const open = mine.filter(
    (a) => a.status !== 'archived' && listed.some((s) => String(s._id) === a.site.id),
  )
  const stored = await AssessmentModel.find(
    { _id: { $in: open.map((a) => a.id) } },
    'locations riskQuality',
  ).lean()
  const [observations, priorities] = await Promise.all([
    listObservationsOf(stored),
    acceptedOfiPriorities(stored.map((a) => a._id)),
  ])
  const scores = new Map(stored.map((a) => [String(a._id), a.riskQuality?.categories ?? []]))
  const counted = open.map((a) =>
    count(a, observations.get(a.id) ?? [], priorities.get(a.id) ?? [], scores.get(a.id) ?? []),
  )

  const day = today()
  const current = new Map<string, Counted>()
  const sites: InsightSite[] = []
  for (const site of listed) {
    const here = counted
      .filter((c) => c.assessment.site.id === String(site._id))
      .sort((a, b) => oldestFirst(a.assessment, b.assessment))
    if (!here.length) continue
    const assessed = here.filter((c) => c.observations.length)
    // Its latest assessment with observations: a visit still to come, with
    // nothing captured, must not blank what the last one found.
    const latest = assessed[assessed.length - 1] ?? here[here.length - 1]
    current.set(String(site._id), latest)
    const visits = assessed.map((c): InsightVisit => ({
      reference: c.assessment.reference,
      siteVisitDate: c.assessment.siteVisitDate,
      surveyType: c.assessment.surveyType,
      observations: c.observations.length,
      criticalHigh: c.critical + c.high,
      ofis: c.ofis.accepted,
      score: c.rating?.score ?? null,
      rating: c.rating?.rating ?? null,
    }))
    const delta =
      visits.length > 1 ? visits[visits.length - 1].criticalHigh - visits[0].criticalHigh : null
    const figures: Omit<InsightSite, 'reasons'> = {
      id: String(site._id),
      name: site.name,
      facilityType: site.facilityType,
      jurisdiction: site.jurisdiction,
      reference: latest.assessment.reference,
      siteVisitDate: latest.assessment.siteVisitDate,
      status: latest.assessment.status,
      observations: latest.observations.length,
      critical: latest.critical,
      high: latest.high,
      uncategorised: latest.cells[latest.cells.length - 1].count,
      cells: latest.cells,
      ofis: latest.ofis,
      rating: latest.rating,
      visits,
      change: delta === null ? null : delta > 0 ? 'worse' : delta < 0 ? 'improved' : 'same',
    }
    const late = Math.max(0, ...here.map((c) => daysLate(c.assessment, day)))
    sites.push({ ...figures, reasons: reasonsOf(figures, late) })
  }
  sites.sort(bySeverity)

  const byCategory = CATEGORIES.map((category, i) => ({
    category,
    count: sites.reduce((n, s) => n + s.cells[i].count, 0),
    critical: sites.reduce((n, s) => n + s.cells[i].critical, 0),
    high: sites.reduce((n, s) => n + s.cells[i].high, 0),
  }))
  const lateReports = open
    .filter((a) => sites.some((s) => s.id === a.site.id))
    .map((a) => ({ site: a.site.name, days: daysLate(a, day) }))
    .filter((r) => r.days > 0)
    .sort((a, b) => b.days - a.days)
  const sum = (pick: (s: InsightSite) => number) => sites.reduce((n, s) => n + pick(s), 0)

  const insights: ClientInsightsDto = {
    rulesVersion: INSIGHTS_RULES,
    empty: !sites.some((s) => s.observations),
    totals: {
      sites: sites.length,
      assessments: open.filter((a) => sites.some((s) => s.id === a.site.id)).length,
      observations: sum((s) => s.observations),
      uncategorised: sum((s) => s.uncategorised),
      critical: sum((s) => s.critical),
      high: sum((s) => s.high),
      ofisAccepted: sum((s) => s.ofis.accepted),
      ofisPriority12: sum((s) => s.ofis.priority1 + s.ofis.priority2),
      reportsLate: lateReports.length,
      latest: lateReports[0] ?? null,
    },
    byCategory,
    sites,
    findings: findingsOf(sites, byCategory),
  }
  return {
    client: { id: String(client._id), name: client.name },
    insights,
    evidence: evidenceOf(sites, byCategory, current),
  }
}
