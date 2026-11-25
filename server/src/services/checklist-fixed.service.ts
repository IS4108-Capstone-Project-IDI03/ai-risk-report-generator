// CP-37: fixed checklist items per site type. Called by routes/checklist-settings.routes.ts (the
// admin editor) and by checklist.service.ts `generateChecklist` (which copies them in).
import { Types, isValidObjectId } from 'mongoose'
import { z } from 'zod'
import {
  ChecklistFixedItemModel,
  type IChecklistFixedItem,
} from '../models/checklist-fixed-item.model'
import { FACILITY_TYPES } from './knowledge-document.service'
import { SettingsInputError } from './settings.service'
import type { SessionUser } from './auth.service'
import seed from './checklist-fixed.json'

// Report sections only: a fixed item has no hazard, so a 'hazards' area would never show it.
const AREAS = ['7', '8', '9', '10', '11', '12']

// About 20 words, so every checklist item fits on one or two lines (CP-37); 25 leaves room for a
// long name. Shared with checklist.service.ts `itemText`; it lives here because that file imports
// this one, and the reverse import would be circular.
export const withinWords = (t: string) => t.split(/\s+/).length <= 25
export const WORDS_MESSAGE = 'Keep it to about 20 words.'

const addSchema = z.object({
  facilityType: z
    .string()
    .refine((t) => FACILITY_TYPES.includes(t), 'Choose a site type from the list.'),
  text: z
    .string()
    .trim()
    .min(1, 'Write the question.')
    .max(500, 'A question is 500 characters or fewer.')
    .refine(withinWords, WORDS_MESSAGE),
  area: z
    .string()
    // An empty string clears the section, as the editor sends it.
    .refine((a) => a === '' || AREAS.includes(a), 'Choose a report section.')
    .transform((a) => a || null)
    .nullish(),
})
const editSchema = addSchema.pick({ text: true, area: true }).partial()

const dto = (d: IChecklistFixedItem & { _id: Types.ObjectId }) => ({
  id: String(d._id),
  facilityType: d.facilityType,
  text: d.text,
  area: d.area ?? null,
  removed: !!d.removed,
})
const metadata = (facilityType: string) => ({
  source_type: 'checklist' as const,
  jurisdiction: 'all' as const,
  facility_type: facilityType,
  COPE_dimension: 'all' as const,
  effective_date: new Date(),
})
const invalid = (e: z.ZodError) => new SettingsInputError(e.issues[0].message)

/**
 * Fills the empty collection from checklist-fixed.json once, at server start. Without it the demo
 * would show no fixed items until an admin typed some. Never fills it again, since removing is soft.
 */
export async function seedFixedItems() {
  if (await ChecklistFixedItemModel.exists({})) return
  const rows = Object.entries(seed)
    .filter(([type]) => FACILITY_TYPES.includes(type))
    .flatMap(([facilityType, texts]) =>
      (texts as string[]).map((text) => ({
        facilityType,
        text,
        area: null,
        metadata: metadata(facilityType),
      })),
    )
  await ChecklistFixedItemModel.insertMany(rows)
}

/** Returns the site types and every fixed item, removed ones too, for the admin editor. */
export async function listFixedItems() {
  const items = await ChecklistFixedItemModel.find().sort({ createdAt: 1, _id: 1 }).lean()
  return { facilityTypes: FACILITY_TYPES, items: items.map(dto) }
}

/** Returns the fixed items to copy into a checklist for this site type, removed ones left out. */
export async function fixedItemsFor(facilityType: string) {
  const items = await ChecklistFixedItemModel.find({ facilityType, removed: null })
    .sort({ createdAt: 1, _id: 1 })
    .lean()
  return items.map(({ text, area }) => ({ text, area }))
}

/** Adds a fixed item and returns it. Throws SettingsInputError (400) on a bad value. */
export async function addFixedItem(input: unknown) {
  const parsed = addSchema.safeParse(input)
  if (!parsed.success) throw invalid(parsed.error)
  const { facilityType, text, area } = parsed.data
  const made = await ChecklistFixedItemModel.create({
    facilityType,
    text,
    area: area ?? null,
    metadata: metadata(facilityType),
  })
  return dto(made.toObject())
}

async function found(id: string) {
  const item = isValidObjectId(id) ? await ChecklistFixedItemModel.findById(id) : null
  if (!item) throw new SettingsInputError('That checklist item was not found.', 404)
  return item
}

/** Changes a fixed item's text or section and returns it. Throws SettingsInputError (400, 404). */
export async function editFixedItem(id: string, input: unknown) {
  const parsed = editSchema.safeParse(input)
  if (!parsed.success) throw invalid(parsed.error)
  const item = await found(id)
  if (parsed.data.text !== undefined) item.text = parsed.data.text
  if (parsed.data.area !== undefined) item.area = parsed.data.area
  await item.save()
  return dto(item.toObject())
}

/** Removes (soft) or restores a fixed item and returns it. Throws SettingsInputError (404). */
export async function setFixedItemRemoved(id: string, remove: boolean, user: SessionUser) {
  const item = await found(id)
  item.removed = remove ? { at: new Date(), by: { id: user.id, name: user.name } } : null
  await item.save()
  return dto(item.toObject())
}
