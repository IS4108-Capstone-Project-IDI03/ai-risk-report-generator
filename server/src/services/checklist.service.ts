// Pre-survey checklist (CP-30): the standards that apply to an assessment's
// site, and generating a checklist through S4 from the ones the engineer keeps.
// Called by assessment.routes; calls rag.service and the checklists collection.
import { isValidObjectId, type Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import {
  CHECK_MARKS,
  ChecklistModel,
  type CheckMark,
  type IChecklist,
  type IChecklistItem,
} from '../models/checklist.model'
import type { CheckResult } from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { listApplicableStandards } from './knowledge-document.service'
import { locationText } from './location.service'
import { checkingObservations } from './observation.service'
import { requestChecklistDraft } from './rag.service'
import { assessmentToDraft } from './section.service'

// A standard sent to generate with that isn't one of the site's (AC1), e.g.
// one withdrawn since the tab was opened.
export class UnknownStandardError extends Error {
  constructor() {
    super('One of the chosen standards no longer applies to this site. Reload and try again.')
    this.name = 'UnknownStandardError'
  }
}

export class ChecklistItemNotFoundError extends Error {
  constructor() {
    super('This item is not on the latest checklist. Reload the checklist.')
    this.name = 'ChecklistItemNotFoundError'
  }
}

// A mark asked for on an item an observation checks (CP-31): the observation
// says more than the mark would, so it is deleted first (AC5).
export class ItemCheckedError extends Error {
  constructor() {
    super(
      'An observation checks this item. Delete that observation in Observations to mark the item instead.',
    )
    this.name = 'ItemCheckedError'
  }
}

// The body of PUT .../checklist/items/:itemId/mark: a mark, or null to clear it.
export const checklistMarkSchema = z.object({ mark: z.enum(CHECK_MARKS).nullable() })

export const generateChecklistSchema = z.object({
  // The standards kept ticked (AC2); none still gives template and hazard items (AC10).
  standardIds: z.array(z.string()).max(200),
})

export type StandardDto = {
  id: string
  title: string
  issuingBody: string | null
  standardNumber: string | null
  edition: string | null
  sourceType: string | null
  // When it was added to the knowledge base, so the tab can tick a standard
  // added since the last checklist (it ticks the ones that checklist used).
  uploadedAt: Date
}

type Checklist = IChecklist & { _id: Types.ObjectId }

// Where an item stands on site (CP-31): answered by an observation, Confirmed
// or Differs, or marked without one; null while unchecked.
export type ItemCheckDto = {
  result: CheckResult | CheckMark
  at: Date
  by: string
  // The observation that checks it, and where it was made; null for a mark.
  observation: { id: string; location: string | null } | null
}

// Each item's check: the latest observation not deleted that links to it, here
// or in an earlier checklist it was carried from, else its mark.
async function itemChecks(checklist: Checklist): Promise<Map<string, ItemCheckDto>> {
  const [observations, assessment] = await Promise.all([
    checkingObservations(checklist.assessment),
    AssessmentModel.findById(checklist.assessment, 'locations').lean(),
  ])
  // Oldest first, so the latest observation of an item is the one kept.
  const byItem = new Map(observations.map((o) => [String(o.checklistItem!.item), o]))
  const checks = new Map<string, ItemCheckDto>()
  for (const item of checklist.items) {
    const answer = [item._id, ...(item.carried ?? [])]
      .map((id) => byItem.get(String(id)))
      .filter((o) => o !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    if (answer) {
      const location = assessment?.locations?.find((l) => l._id.equals(answer.location))
      checks.set(String(item._id), {
        result: answer.checklistItem!.result,
        at: answer.createdAt,
        by: answer.engineer,
        observation: { id: String(answer._id), location: location ? locationText(location) : null },
      })
    } else if (item.check) {
      checks.set(String(item._id), {
        result: item.check.mark,
        at: item.check.at,
        by: item.check.by.name,
        observation: null,
      })
    }
  }
  return checks
}

function toDto(
  { _id, assessment: _a, createdBy: _c, metadata: _m, items, ...c }: Checklist,
  checks: Map<string, ItemCheckDto>,
) {
  return {
    id: String(_id),
    ...c,
    items: items.map(({ _id: itemId, check: _k, carried: _f, ...item }) => ({
      id: String(itemId),
      ...item,
      check: checks.get(String(itemId)) ?? null,
    })),
  }
}
export type ChecklistDto = ReturnType<typeof toDto>

async function applicable(site: Pick<ISite, 'facilityType' | 'jurisdiction'>) {
  return (await listApplicableStandards(site.facilityType, site.jurisdiction)).map(
    (d): StandardDto => ({
      id: d.id,
      title: d.title,
      issuingBody: d.issuingBody,
      standardNumber: d.standardNumber,
      edition: d.edition,
      sourceType: d.sourceType,
      uploadedAt: d.uploadedAt,
    }),
  )
}

async function latestStored(assessment: Types.ObjectId) {
  return ChecklistModel.findOne({ assessment }).sort({ createdAt: -1, _id: -1 }).lean<Checklist>()
}

async function latest(assessment: Types.ObjectId) {
  const found = await latestStored(assessment)
  return found ? toDto(found, await itemChecks(found)) : null
}

type ItemPlace = Pick<
  IChecklistItem,
  'origin' | 'area' | 'subsection' | 'hazard' | 'text' | 'citations'
>

// Where an item sits: its report section, or its hazard. Not its subsection:
// the model files the same requirement under a subsection on one run and
// under the section itself on the next.
const placeOf = (i: ItemPlace) => `${i.area}|${i.hazard ?? ''}`
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9.]+/g) ?? [])
// The share of their words two wordings have in common, from 0 to 1.
function likeness(a: string, b: string) {
  const x = wordsOf(a)
  const y = wordsOf(b)
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / (new Set([...x, ...y]).size || 1)
}

// Whether a new item is the same one as an earlier item of the checklist it
// replaces (CP-31), and how alike they are, to pair the most alike first; null
// when they are not. A template subsection, or a hazard's own item, is the same
// by where it sits. The model words its items afresh on every run, so one of
// its items is the same when it sits in the same section or hazard and cites a
// passage the earlier one cited, or is worded the same: the same requirement,
// however worded. Under the same subsection, it is the closer pair.
function sameness(earlier: ItemPlace, item: ItemPlace): number | null {
  if (earlier.origin !== item.origin) return null
  if (item.origin === 'template') {
    return earlier.area === item.area && earlier.subsection === item.subsection ? 2 : null
  }
  if (item.origin === 'hazard_list') return earlier.hazard === item.hazard ? 2 : null
  if (placeOf(earlier) !== placeOf(item)) return null
  const worded = (i: ItemPlace) => i.text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (worded(earlier) === worded(item)) return 2
  const cited = earlier.citations.some((c) => item.citations.some((d) => d.ref === c.ref))
  if (!cited) return null
  return likeness(earlier.text, item.text) + (earlier.subsection === item.subsection ? 0.5 : 0)
}

// Carries the answers of the latest checklist into a regenerated one (CP-31):
// each new item that is the same as an earlier one takes its mark, and its id
// with those it was carried from, so the observations that answered it still
// do. Pairs are made most alike first, each item once. Returns the new items;
// how many answered items were kept; the text of each one not kept, so the
// engineer knows what to answer again (its observation stays, on its own);
// and the positions of the new items that may replace one, unpaired and in
// the same place.
function carryOver<T extends ItemPlace>(
  previous: Checklist | null,
  checks: Map<string, ItemCheckDto>,
  items: T[],
) {
  const earlier = previous?.items ?? []
  const pairs = items
    .flatMap((item, n) => earlier.map((before, b) => ({ n, b, score: sameness(before, item) })))
    .filter((p): p is { n: number; b: number; score: number } => p.score !== null)
    .sort((x, y) => y.score - x.score)
  const match = new Map<number, IChecklistItem>()
  const used = new Set<number>()
  for (const { n, b } of pairs) {
    if (match.has(n) || used.has(b)) continue
    match.set(n, earlier[b])
    used.add(b)
  }
  const carried = items.map((item, n) => {
    const before = match.get(n)
    if (!before) return item
    return {
      ...item,
      check: before.check ?? null,
      carried: [before._id, ...(before.carried ?? [])],
    }
  })
  const lost = earlier.filter((i, b) => checks.has(String(i._id)) && !used.has(b))
  const lostPlaces = new Set(lost.map(placeOf))
  return {
    items: carried,
    kept: [...used].filter((b) => checks.has(String(earlier[b]._id))).length,
    dropped: lost.map((i) => i.text),
    mayReplace: items.flatMap((item, n) =>
      !match.has(n) && lostPlaces.has(placeOf(item)) ? [n] : [],
    ),
  }
}

// The site's scope, the standards that apply to it now (AC1), and the latest
// checklist (AC9), or null before the first is generated.
export async function getChecklist(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  const site = assessment.site
  return {
    scope: { facilityType: site.facilityType, jurisdiction: site.jurisdiction },
    standards: await applicable(site),
    checklist: await latest(assessment._id),
  }
}

// Generates a checklist from the standards kept in scope and saves it as the
// assessment's latest; the earlier ones are kept. Only the assigned engineer
// can, while the assessment is not archived (AC11).
export async function generateChecklist(
  reference: string,
  user: SessionUser,
  input: z.infer<typeof generateChecklistSchema>,
) {
  const assessment = await assessmentToDraft(reference, user)
  const site = assessment.site
  if (!site) throw new AssessmentNotFoundError(reference)
  const standards = await applicable(site)
  const chosen = new Set(input.standardIds)
  if ([...chosen].some((id) => !standards.some((s) => s.id === id))) {
    throw new UnknownStandardError()
  }
  const inScope = standards.filter((s) => chosen.has(s.id))

  // Only the kind of site goes to S4, so no client detail needs masking.
  const draft = await requestChecklistDraft({
    facility_type: site.facilityType,
    jurisdiction: site.jurisdiction,
    standards: inScope.map((s) => ({
      id: s.id,
      source_type: s.sourceType,
      standard_number: s.standardNumber,
    })),
  })
  // Its paid calls, for the cost report (EV-03), all under the checklist, as
  // chat's are under chat.
  if (Array.isArray(draft.usage)) {
    await recordAiCalls(
      draft.usage.map((u: object) => ({ ...u, feature: 'checklist' })),
      { reportId: reference },
    )
  }

  const previous = await latestStored(assessment._id)
  const carried = carryOver(
    previous,
    previous ? await itemChecks(previous) : new Map<string, ItemCheckDto>(),
    draft.items.map(({ citations, ...item }) => ({
      ...item,
      citations: citations.map((c) => ({ ref: c.ref, quote: c.quote, quoteFound: c.quote_found })),
    })),
  )
  const saved = await ChecklistModel.create({
    assessment: assessment._id,
    facilityType: site.facilityType,
    jurisdiction: site.jurisdiction,
    standards: inScope.map(({ issuingBody: _i, uploadedAt: _u, ...s }) => s),
    items: carried.items,
    areas: draft.areas,
    hazards: draft.hazards.map(({ in_scope, ...h }) => ({ ...h, inScope: in_scope })),
    sources: draft.sources,
    provenance: { ...draft.provenance, generated_at: new Date(draft.provenance.generated_at) },
    createdBy: user.id,
    metadata: {
      source_type: 'checklist',
      jurisdiction: site.jurisdiction,
      facility_type: site.facilityType,
      COPE_dimension: 'all',
      effective_date: new Date(),
    },
  })
  const stored = saved.toObject() as Checklist
  return {
    scope: { facilityType: site.facilityType, jurisdiction: site.jurisdiction },
    standards,
    checklist: toDto(stored, await itemChecks(stored)),
    // The answers of the checklist it replaces: how many were carried over, the
    // items whose answers stayed with it, and the new items that may replace
    // those, for the tab to point out.
    carryOver: {
      kept: carried.kept,
      dropped: carried.dropped,
      mayReplace: carried.mayReplace.map((n) => String(stored.items[n]._id)),
    },
  }
}

// Marks an item of the latest checklist Not seen or Not applicable, or clears
// its mark (CP-31 AC4). No observation is saved. Only the assigned engineer
// can, while the assessment is not archived (AC8).
export async function markChecklistItem(
  reference: string,
  itemId: string,
  mark: CheckMark | null,
  user: SessionUser,
) {
  const assessment = await assessmentToDraft(reference, user)
  const checklist = await latestStored(assessment._id)
  const item = isValidObjectId(itemId) && checklist?.items.find((i) => i._id.equals(itemId))
  if (!checklist || !item) throw new ChecklistItemNotFoundError()
  if (mark && (await itemChecks(checklist)).get(itemId)?.observation) throw new ItemCheckedError()
  await ChecklistModel.updateOne(
    { _id: checklist._id, 'items._id': item._id },
    {
      $set: {
        'items.$.check': mark && { mark, at: new Date(), by: { id: user.id, name: user.name } },
      },
    },
  )
  return getChecklist(reference)
}
