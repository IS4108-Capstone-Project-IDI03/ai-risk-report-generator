// Pre-survey checklist (CP-30): the standards that apply to an assessment's
// site, and generating a checklist through S4 from the ones the engineer keeps.
// The engineer's own changes to it (CP-32): adding, editing, removing and
// restoring items, a passage search for their references, and the PDF to take
// on site. Called by assessment.routes; calls rag.service and the checklists
// collection.
import { isValidObjectId, Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import {
  CHECK_MARKS,
  ChecklistModel,
  type CheckMark,
  type IChecklist,
  type IChecklistCitation,
  type IChecklistItem,
  type ItemOrigin,
} from '../models/checklist.model'
import { COPE_DIMENSIONS, type CheckResult } from '../models/observation.model'
import type { ISite } from '../models/site.model'
import { recordAiCalls } from './ai-usage.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { checklistPdfHtml } from './checklist-pdf'
import { clientNameOf } from './client.service'
import { printPdf, withExportPage } from './export-render.service'
import { exportDay } from './export.service'
import { listApplicableStandards } from './knowledge-document.service'
import { locationText } from './location.service'
import { checkingObservations } from './observation.service'
import { findPassage, requestChecklistDraft, searchPassages } from './rag.service'
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

// A change refused by the rules for customising a checklist (CP-32), e.g.
// removing a report template item; its message says what to do instead.
export class ChecklistChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistChangeError'
  }
}

// An item or reference that doesn't fit the checklist, e.g. a section it
// doesn't have or a passage from a standard outside its scope (CP-32).
export class InvalidChecklistItemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChecklistItemError'
  }
}

export class NoChecklistError extends Error {
  constructor() {
    super('This assessment has no checklist yet. Generate it first.')
    this.name = 'NoChecklistError'
  }
}

const REMOVED = 'This item was removed from the checklist. Restore it first.'

// An item's wording, and its COPE categories: one or more, stored in C-O-P-E
// order without repeats, as an observation's are (CP-32).
const itemText = z.string().trim().min(1, 'Write what to check.').max(1000)
const itemCategories = z
  .array(z.enum(COPE_DIMENSIONS))
  .min(1, 'Choose at least one category.')
  .transform((chosen) => COPE_DIMENSIONS.filter((c) => chosen.includes(c)))

// The body of POST .../checklist/items: an item the engineer adds (CP-32 AC1),
// under a report section (and optionally one of its subsections) or a risk.
export const addChecklistItemSchema = z.object({
  area: z.string().min(1).max(40),
  subsection: z.string().max(300).nullish(),
  hazard: z.string().max(80).nullish(),
  text: itemText,
  COPE_dimension: itemCategories,
})

// The body of PATCH .../checklist/items/:itemId: what the engineer changed
// (CP-32 AC1-2). `citations` replaces the item's references: each a passage
// (`C:<id>`) with the words it rests on, or none to take its first sentence.
export const editChecklistItemSchema = z
  .object({
    text: itemText.optional(),
    COPE_dimension: itemCategories.optional(),
    citations: z
      .array(
        z.object({
          ref: z.string().max(300).regex(/^C:.+/),
          quote: z.string().trim().max(1000),
        }),
      )
      .max(10)
      .optional(),
  })
  .refine((e) => e.text !== undefined || e.COPE_dimension !== undefined || e.citations, {
    message: 'Send what to change.',
  })

// The query of GET .../checklist/passages: the words to look for.
export const passageSearchSchema = z.object({ q: z.string().trim().min(1).max(500) })

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
    items: items.map(({ _id: itemId, check: _k, carried: _f, edited, removed, ...item }) => ({
      id: String(itemId),
      ...item,
      // Who edited or removed it, and when (CP-32); checklists from before
      // CP-32 have neither.
      edited: edited ? { at: edited.at, by: edited.by.name } : null,
      removed: removed ? { at: removed.at, by: removed.by.name } : null,
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

// The standards the engineer kept in scope on the assessment's latest
// checklist (AC2), by knowledge document id, or null before the first is
// generated. The Ask tab (AS-01) searches them as the assessment's selected
// standards.
export async function selectedStandardIds(assessment: Types.ObjectId): Promise<string[] | null> {
  const found = await latestStored(assessment)
  return found ? found.standards.map((s) => s.id) : null
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

// The item as generated, which a later generation is matched against: an
// edited item's wording, categories and references before the engineer
// changed them (CP-32 AC3).
const asGenerated = (i: IChecklistItem): IChecklistItem => ({ ...i, ...(i.edited?.was ?? {}) })

// An item's flags for its references: one the model or the hazard list wrote
// is 'uncited' while it rests on no passage (CP-30 AC6); a template item or
// the engineer's own never is.
function flagsFor(origin: ItemOrigin, citations: IChecklistCitation[], flags: 'uncited'[]) {
  const others = flags.filter((f) => f !== 'uncited')
  const cited = origin === 'template' || origin === 'manual' || citations.length > 0
  return cited ? others : [...others, 'uncited' as const]
}

// An item as S4 generated it, and as it is saved, with what it carries over.
type Generated = ItemPlace & Pick<IChecklistItem, 'COPE_dimension' | 'flags' | 'fields'>
type Carried = Generated &
  Partial<Pick<IChecklistItem, 'status' | 'removed' | 'edited' | 'check' | 'carried'>>

// Carries the latest checklist into a regenerated one: its answers (CP-31) and
// the engineer's changes (CP-32 AC3). Each new item that is the same as an
// earlier one takes its mark, and its id with those it was carried from, so
// the observations that answered it still do; and, when the engineer edited or
// removed the earlier one, the engineer's wording and references, or its
// removal. Pairs are made most alike first, each item once, matching an edited
// item as it was generated. The engineer's own items, and edited items no new
// item matches, are kept as they are, after the new ones. Returns the items;
// the passages their kept references cite; how many answered items were kept;
// the text of each one not kept, so the engineer knows what to answer again
// (its observation stays, on its own); the positions of the new items that may
// replace one, unpaired and in the same place; and how many of the engineer's
// changes were kept.
function carryOver(
  previous: Checklist | null,
  checks: Map<string, ItemCheckDto>,
  items: Generated[],
) {
  const earlier = previous?.items ?? []
  const pairs = items
    .flatMap((item, n) =>
      earlier.map((before, b) => ({ n, b, score: sameness(asGenerated(before), item) })),
    )
    .filter((p): p is { n: number; b: number; score: number } => p.score !== null)
    .sort((x, y) => y.score - x.score)
  const match = new Map<number, IChecklistItem>()
  const used = new Set<number>()
  for (const { n, b } of pairs) {
    if (match.has(n) || used.has(b)) continue
    match.set(n, earlier[b])
    used.add(b)
  }
  const carried = items.map((item, n): Carried => {
    const before = match.get(n)
    if (!before) return item
    const edited = before.edited && {
      text: before.text,
      COPE_dimension: before.COPE_dimension,
      citations: before.citations,
      flags: flagsFor(item.origin, before.citations, item.flags),
      // The new wording is what the next generation is matched against.
      edited: {
        ...before.edited,
        was: { text: item.text, COPE_dimension: item.COPE_dimension, citations: item.citations },
      },
    }
    return {
      ...item,
      ...edited,
      ...(before.status === 'removed' && { status: 'removed' as const, removed: before.removed }),
      check: before.check ?? null,
      carried: [before._id, ...(before.carried ?? [])],
    }
  })
  // The engineer's own items, and edited items nothing matched, still in use.
  const keptOwn = new Set<number>()
  const own = earlier.flatMap((before, b): Carried[] => {
    if (used.has(b) || before.status === 'removed') return []
    if (before.origin !== 'manual' && !before.edited) return []
    keptOwn.add(b)
    const { _id, ...rest } = before
    return [{ ...rest, carried: [_id, ...(before.carried ?? [])] }]
  })
  const all = [...carried, ...own]
  // A priority risk keeps an item in use (CP-30 AC3): if every item of it
  // came back removed, the first is restored.
  for (const hazard of new Set(all.map((i) => i.hazard))) {
    const of = all.filter((i) => hazard && i.hazard === hazard)
    if (of.length && of.every((i) => i.status === 'removed')) {
      all[all.indexOf(of[0])] = { ...of[0], status: 'active', removed: null }
    }
  }
  // The passages the engineer's references cite, from the checklist they were
  // chosen on.
  const known = (previous?.sources ?? {}) as Record<string, unknown>
  const sources: Record<string, unknown> = {}
  const engineerCited = [
    ...own.flatMap((i) => i.citations),
    ...carried.flatMap((i, n) => (match.get(n)?.edited ? i.citations : [])),
  ]
  for (const { ref } of engineerCited) if (known[ref]) sources[ref] = known[ref]
  const lost = earlier.filter(
    (i, b) => checks.has(String(i._id)) && !used.has(b) && !keptOwn.has(b),
  )
  const lostPlaces = new Set(lost.map(placeOf))
  const inUse = (i: Carried) => i.status !== 'removed'
  return {
    items: all,
    sources,
    kept: [...used, ...keptOwn].filter((b) => checks.has(String(earlier[b]._id))).length,
    dropped: lost.map((i) => i.text),
    mayReplace: items.flatMap((item, n) =>
      !match.has(n) && lostPlaces.has(placeOf(item)) ? [n] : [],
    ),
    changes: {
      edited: all.filter((i) => inUse(i) && i.edited).length,
      added: all.filter((i) => inUse(i) && i.origin === 'manual').length,
      removed: all.filter((i) => !inUse(i)).length,
    },
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
      citations: citations.map((c) => ({
        ref: c.ref,
        quote: c.quote,
        quoteFound: c.quote_found,
        ...(c.quote_described && { quoteDescribed: true }),
      })),
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
    // The engineer's references keep the passages they were chosen from (CP-32
    // AC3, AC5).
    sources: { ...carried.sources, ...draft.sources },
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
    // those, for the tab to point out; and how many of the engineer's edited,
    // added and removed items were kept (CP-32 AC3).
    carryOver: {
      kept: carried.kept,
      dropped: carried.dropped,
      mayReplace: carried.mayReplace.map((n) => String(stored.items[n]._id)),
      changes: carried.changes,
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
  if (item.status === 'removed') throw new ChecklistChangeError(REMOVED)
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

// --- Customising the checklist (CP-32) ---

// The latest checklist and one of its items, for the assigned engineer to
// change while the assessment is not archived (AC6).
async function itemToChange(reference: string, itemId: string, user: SessionUser) {
  const assessment = await assessmentToDraft(reference, user)
  const checklist = await latestStored(assessment._id)
  const item = isValidObjectId(itemId) && checklist?.items.find((i) => i._id.equals(itemId))
  if (!checklist || !item) throw new ChecklistItemNotFoundError()
  return { assessment, checklist, item }
}

const changeBy = (user: SessionUser) => ({ at: new Date(), by: { id: user.id, name: user.name } })

// Adds the engineer's own item under a report section, or one of its
// subsections, or under a priority risk (AC1). It goes after that place's
// items. Returns the checklist, with the new item's id.
export async function addChecklistItem(
  reference: string,
  user: SessionUser,
  input: z.infer<typeof addChecklistItemSchema>,
) {
  const assessment = await assessmentToDraft(reference, user)
  const checklist = await latestStored(assessment._id)
  if (!checklist) throw new NoChecklistError()
  const risk = input.area === 'hazards'
  const known = risk
    ? checklist.hazards.some((h) => h.id === input.hazard)
    : checklist.areas.some((a) => a.id === input.area)
  if (!known) throw new InvalidChecklistItemError('Choose a report section or priority risk.')
  const subsection = risk ? null : (input.subsection ?? null)
  if (
    subsection &&
    !checklist.items.some(
      (i) => i.origin === 'template' && i.area === input.area && i.subsection === subsection,
    )
  ) {
    throw new InvalidChecklistItemError('Choose a subsection of that report section.')
  }
  const id = new Types.ObjectId()
  await ChecklistModel.updateOne(
    { _id: checklist._id },
    {
      $push: {
        items: {
          _id: id,
          area: input.area,
          subsection,
          origin: 'manual',
          hazard: risk ? input.hazard : null,
          text: input.text,
          fields: [],
          COPE_dimension: input.COPE_dimension,
          citations: [],
          flags: [],
        },
      },
    },
  )
  return { ...(await getChecklist(reference)), itemId: String(id) }
}

// "Squashed": lower case, each run of spaces one space; "bare": without
// punctuation too. As rag-service's quote check (app/chat/quotes.py), so a
// quote the engineer chose is checked as the model's are.
const squash = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
const bare = (text: string) =>
  squash(text)
    .replace(/[^\p{L}\p{N}\p{M}\s]|_/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

export function quoteFound(quote: string, passage: string) {
  if (!quote.trim()) return false
  return (
    passage.includes(quote) ||
    squash(passage).includes(squash(quote)) ||
    bare(passage).includes(bare(quote))
  )
}

// What a passage's quote is looked for in: its headings, then its text, as S4
// shows a passage to the model (generator.quotable_text). A picture's
// generated description is the model's words, not the document's (KB-02).
type StoredSource = {
  text: string
  doc_id?: string | null
  headings?: string[]
  page_start?: number | null
  page_end?: number | null
  generated_text?: string
}
const described = (s: StoredSource) => s.generated_text === 'picture_description'
const quotable = (s: StoredSource) =>
  [
    ...(s.headings ?? []).filter((h) => h.length <= 200),
    described(s) ? withoutDescription(s.text) : s.text,
  ].join('\n')

// The text without its generated description, which runs to the printed-text
// line or a blank line (S4 generator._without_description).
function withoutDescription(text: string) {
  let skipping = false
  return text
    .split('\n')
    .filter((line) => {
      if (line.startsWith('Image description (generated')) skipping = true
      else if (skipping && (line.startsWith('Text in image:') || !line.trim())) skipping = false
      return !skipping
    })
    .join('\n')
}

// Where a chosen quote is: in the passage's own words, only in a picture's
// generated description (cited, never found), or nowhere (S4 quote_check).
function quoteCheck(quote: string, source: StoredSource) {
  if (quoteFound(quote, quotable(source))) return { quoteFound: true }
  if (described(source) && quoteFound(quote, source.text)) {
    return { quoteFound: false, quoteDescribed: true }
  }
  return { quoteFound: false }
}

// A passage's opening words, for a reference chosen without highlighting any:
// its first sentence, or as many whole words as fit in 240 characters.
export function openingWords(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = /^.+?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat
  if (sentence.length <= 240) return sentence
  const cut = sentence.slice(0, 240)
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : 240)
}

// The references the engineer chose (AC2): each a passage of a standard the
// checklist was generated from, still applying to the site when newly chosen,
// with the words it rests on, checked against it. Returns them, and the new
// passages to keep with the checklist so the references read the same later
// and offline (AC5).
async function chosenCitations(
  checklist: Checklist,
  item: IChecklistItem,
  site: Pick<ISite, 'facilityType' | 'jurisdiction'>,
  chosen: { ref: string; quote: string }[],
) {
  const sources = (checklist.sources ?? {}) as Record<string, StoredSource>
  const inScope = new Set(checklist.standards.map((s) => s.id))
  const added: Record<string, StoredSource> = {}
  let applying: Set<string> | null = null
  const citations: IChecklistCitation[] = []
  for (const { ref, quote } of chosen) {
    const same = item.citations.find((c) => c.ref === ref && (!quote || c.quote === quote))
    if (same) {
      citations.push(same)
      continue
    }
    let source = sources[ref] ?? added[ref]
    if (!source) {
      const passage = await findPassage(ref.slice(2))
      if (!passage) {
        throw new InvalidChecklistItemError(
          'That passage is no longer in the knowledge base. Search again.',
        )
      }
      applying ??= new Set((await applicable(site)).map((s) => s.id))
      if (!passage.documentId || !applying.has(passage.documentId)) {
        throw new InvalidChecklistItemError(
          'That standard no longer applies to this site. Choose a passage from another.',
        )
      }
      source = {
        text: passage.text,
        doc_id: passage.documentId,
        headings: passage.headings,
        page_start: passage.pageStart,
        page_end: passage.pageEnd,
        ...(passage.generated && { generated_text: 'picture_description' }),
      }
      added[ref] = source
    }
    if (!source.doc_id || !inScope.has(source.doc_id)) {
      throw new InvalidChecklistItemError(
        'Choose a passage from the standards this checklist was generated from.',
      )
    }
    const words = quote || openingWords(source.text)
    citations.push({ ref, quote: words, ...quoteCheck(words, source) })
  }
  const unique = citations.filter(
    (c, n) => citations.findIndex((d) => d.ref === c.ref && d.quote === c.quote) === n,
  )
  return { citations: unique, added }
}

const sameList = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b)

// Edits an item's wording, categories or references (AC1-2). A generated item
// remembers how it was generated, so the engineer's edit is kept when the
// checklist is generated again (AC3); the engineer's own item is simply changed.
export async function editChecklistItem(
  reference: string,
  itemId: string,
  user: SessionUser,
  input: z.infer<typeof editChecklistItemSchema>,
) {
  const { assessment, checklist, item } = await itemToChange(reference, itemId, user)
  if (item.status === 'removed') throw new ChecklistChangeError(REMOVED)
  const chosen =
    input.citations && assessment.site
      ? await chosenCitations(checklist, item, assessment.site, input.citations)
      : null
  const text = input.text ?? item.text
  const categories = input.COPE_dimension ?? item.COPE_dimension
  const citations = chosen?.citations ?? item.citations
  const unchanged =
    text === item.text &&
    sameList(categories, item.COPE_dimension) &&
    sameList(citations, item.citations)
  if (unchanged) return getChecklist(reference)
  const set: Record<string, unknown> = {
    'items.$.text': text,
    'items.$.COPE_dimension': categories,
    'items.$.citations': citations,
    'items.$.flags': flagsFor(item.origin, citations, item.flags),
  }
  if (item.origin !== 'manual') {
    set['items.$.edited'] = {
      ...changeBy(user),
      was: item.edited?.was ?? {
        text: item.text,
        COPE_dimension: item.COPE_dimension,
        citations: item.citations,
      },
    }
  }
  if (chosen && Object.keys(chosen.added).length) {
    set.sources = { ...checklist.sources, ...chosen.added }
  }
  await ChecklistModel.updateOne({ _id: checklist._id, 'items._id': item._id }, { $set: set })
  return getChecklist(reference)
}

// Removes an item (AC1): it is kept, marked removed, so it can be restored and
// stays removed when the checklist is generated again (AC3). A report template
// item can't be removed, nor a priority risk's last item, as the checklist
// promises them (CP-30 AC3-4): the engineer marks them Not applicable instead.
// Nor can an item an observation answers, whose answer would be hidden.
export async function removeChecklistItem(reference: string, itemId: string, user: SessionUser) {
  const { checklist, item } = await itemToChange(reference, itemId, user)
  if (item.status === 'removed') return getChecklist(reference)
  if (item.origin === 'template') {
    throw new ChecklistChangeError(
      "A report template item can't be removed: the report has this subsection. Mark it Not applicable instead.",
    )
  }
  const others = checklist.items.filter(
    (i) =>
      i.hazard && i.hazard === item.hazard && i.status !== 'removed' && !i._id.equals(item._id),
  )
  if (item.hazard && others.length === 0) {
    const risk = checklist.hazards.find((h) => h.id === item.hazard)?.name ?? 'this risk'
    throw new ChecklistChangeError(
      `This is the last item for ${risk}. Mark it Not applicable instead.`,
    )
  }
  if ((await itemChecks(checklist)).get(itemId)?.observation) {
    throw new ChecklistChangeError(
      'An observation answers this item. Delete that observation in Observations first, then remove the item.',
    )
  }
  await ChecklistModel.updateOne(
    { _id: checklist._id, 'items._id': item._id },
    { $set: { 'items.$.status': 'removed', 'items.$.removed': changeBy(user) } },
  )
  return getChecklist(reference)
}

// Puts a removed item back where it was.
export async function restoreChecklistItem(reference: string, itemId: string, user: SessionUser) {
  const { checklist, item } = await itemToChange(reference, itemId, user)
  if (item.status !== 'removed') return getChecklist(reference)
  await ChecklistModel.updateOne(
    { _id: checklist._id, 'items._id': item._id },
    { $set: { 'items.$.status': 'active', 'items.$.removed': null } },
  )
  return getChecklist(reference)
}

// The passages to choose a reference from (AC2): a keyword search of the
// latest checklist's standards that still apply to the site. Nothing is
// masked or recorded: S4 searches its own index with no paid call.
export async function searchChecklistPassages(reference: string, query: string) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ISite | null }>('site', 'jurisdiction facilityType')
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  const checklist = await latestStored(assessment._id)
  if (!checklist) throw new NoChecklistError()
  const applying = new Set((await applicable(assessment.site)).map((s) => s.id))
  const ids = checklist.standards.map((s) => s.id).filter((id) => applying.has(id))
  const found = ids.length ? await searchPassages(query, ids, 12) : []
  return {
    results: found.map(({ id, ...passage }) => ({ ref: `C:${id}`, ...passage })),
  }
}

// The checklist as a PDF to take on site (AC4-5), and its name. Anyone who can
// view the assessment can download it: it changes nothing.
export async function checklistPdf(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: (ISite & { client?: { name?: string } }) | null }>({
      path: 'site',
      select: 'name jurisdiction facilityType client',
      populate: { path: 'client', select: 'name' },
    })
    .lean()
  if (!assessment?.site) throw new AssessmentNotFoundError(reference)
  const stored = await latestStored(assessment._id)
  if (!stored) throw new NoChecklistError()
  const at = new Date()
  const html = checklistPdfHtml({
    reference,
    client: clientNameOf(assessment.site, assessment.client) || null,
    site: assessment.site.name,
    visitDate: assessment.siteVisitDate ?? null,
    checklist: toDto(stored, await itemChecks(stored)),
    printedAt: at,
  })
  const file = await withExportPage(html, printPdf)
  const safe = reference.replace(/[^A-Za-z0-9_-]+/g, '-')
  return { file, fileName: `${safe} checklist ${exportDay(at)}.pdf` }
}
