// The report as one document (RV-08): saving a section the engineer wrote or
// revised in the document editor, and reading each section's newest saved
// version back for the review workspace.
//
// Each save adds a version to `report_section_versions`. In a drafted
// section (4 to 12), a finding the engineer changed is also an `edit` entry
// in the review audit log, and one they deleted a `reject` entry, both marked
// `inDocument` (review-decision.service recordDocumentEdits), so its review
// state, the review summary and the history stay as RV-02 reads them, and
// drafts are never changed. Section 2's statements have no review decisions
// (GN-07), so its changes are kept in the version only.
// Called by routes/assessment.routes.ts; review.service reads the versions.
import type { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import type { CopeDimension } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import {
  DOCUMENT_MARKS,
  ReportSectionVersionModel,
  type IReportSectionVersion,
  type SectionDocument,
} from '../models/report-section-version.model'
import { AssessmentNotFoundError } from './capture-session.service'
import { isDuplicateKeyError } from './mongo-errors'
import { MAX_FINDING_LENGTH, recordDocumentEdits, StaleDraftError } from './review-decision.service'
import { assessmentToDraft, sectionDrafts, templateSection, type Draft } from './section.service'
import { plainText, textBlocksOf, textLength } from './section-document'

export type { SectionDocument } from '../models/report-section-version.model'

// The parts of the report with no draft of their own in report_sections:
// Purpose and Scope, the OFIs and Appendix A. Their fixed content stays as it
// is; the document holds what the engineer adds to them.
export const UNDRAFTED_PARTS = new Set(['1', '3', 'A'])

// Limits on one section's document, well above any real section.
export const MAX_RUN_LENGTH = 5000
export const MAX_BLOCKS = 400
export const MAX_SECTION_TEXT = 60_000

export class DocumentShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentShapeError'
  }
}
export class StaleDocumentError extends Error {
  constructor() {
    super(
      'This section was saved from somewhere else after you opened the document. Reload it to see the newer text, then make your change again.',
    )
    this.name = 'StaleDocumentError'
  }
}

const inlineSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(MAX_RUN_LENGTH),
    marks: z.array(z.enum(DOCUMENT_MARKS)).max(DOCUMENT_MARKS.length).optional(),
  }),
  z.strictObject({
    type: z.literal('cite'),
    id: z.string().regex(/^[COPS]:\S{1,200}$/, 'A citation names its source.'),
  }),
])
const paragraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  finding: z
    .string()
    .regex(/^\d+\.\d+$/)
    .nullish(),
  content: z.array(inlineSchema).max(MAX_BLOCKS),
})
const listSchema = <T extends 'bulletList' | 'orderedList'>(type: T) =>
  z.strictObject({ type: z.literal(type), items: z.array(paragraphSchema).min(1).max(MAX_BLOCKS) })
const blockSchema = z.discriminatedUnion('type', [
  paragraphSchema,
  z.strictObject({
    type: z.literal('heading'),
    finding: paragraphSchema.shape.finding,
    content: z.array(inlineSchema).max(MAX_BLOCKS),
  }),
  listSchema('bulletList'),
  listSchema('orderedList'),
])
const blocksSchema = z.array(blockSchema).max(MAX_BLOCKS)
export const sectionDocumentSchema = z.strictObject({
  intro: blocksSchema,
  subsections: z
    .array(z.strictObject({ heading: z.string().max(300), blocks: blocksSchema }))
    .max(50),
})

// The body of PUT …/sections/:sectionId/document: the section's text, the
// version it was edited from (0 for none) and the saved draft it was built on.
export const saveDocumentSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  draftId: z.string().min(1).nullable(),
  document: sectionDocumentSchema,
})
export type SaveDocumentInput = z.infer<typeof saveDocumentSchema>

// The document fits the section: the draft's subsections in order (none for
// a section without a draft), nothing in a table subsection, each finding of
// the draft at most once, and its text within the limits.
function checkShape(document: SectionDocument, draft: Draft | null) {
  const expected = draft?.subsections ?? []
  if (
    document.subsections.length !== expected.length ||
    document.subsections.some((sub, i) => sub.heading !== expected[i].heading)
  )
    throw new DocumentShapeError(
      "The document's subsections do not match the section's. Reload the document and save again.",
    )
  document.subsections.forEach((sub, i) => {
    if (expected[i].kind === 'table' && sub.blocks.length)
      throw new DocumentShapeError(
        `${sub.heading} is a table filled from measured values, so it takes no text.`,
      )
  })
  const keys = new Set<string>()
  for (const block of textBlocksOf(document)) {
    if (!block.finding) continue
    const [i, j] = block.finding.split('.').map(Number)
    if (!draft?.subsections[i]?.statements[j] || keys.has(block.finding))
      throw new DocumentShapeError(
        `Finding ${block.finding} is not in this section's draft, or appears twice.`,
      )
    keys.add(block.finding)
    const length = plainText(block.content).length
    if (length > MAX_FINDING_LENGTH)
      throw new DocumentShapeError(
        `A finding must be ${MAX_FINDING_LENGTH.toLocaleString('en-GB')} characters or fewer; one is ${length.toLocaleString('en-GB')}. Split it, or write the rest as a new paragraph.`,
      )
  }
  if (textLength(document) > MAX_SECTION_TEXT)
    throw new DocumentShapeError(
      `A section must be ${MAX_SECTION_TEXT.toLocaleString('en-GB')} characters or fewer.`,
    )
}

export type SectionVersionDto = {
  version: number
  // The saved draft it was edited from, or null.
  draftId: string | null
  document: SectionDocument
  savedAt: Date
  savedBy: { id: string; name: string }
}
type Version = IReportSectionVersion & { _id: Types.ObjectId }
function toVersionDto(v: Version): SectionVersionDto {
  return {
    version: v.version,
    draftId: v.draft ? String(v.draft) : null,
    document: v.document,
    savedAt: v.at,
    savedBy: { id: v.by.id, name: v.by.name },
  }
}

// The newest Section 2 (Executive Summary) draft: its saved content (GN-07).
export async function summaryDraft(assessment: Types.ObjectId): Promise<Draft | null> {
  return await ReportSectionModel.findOne({ assessment, sectionId: '2' })
    .sort({ createdAt: -1 })
    .lean<Draft>()
}

// The assessment's ID by reference.
export async function assessmentIdOf(reference: string): Promise<Types.ObjectId> {
  const assessment = await AssessmentModel.findOne({ reference }, '_id').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return assessment._id
}

// Each section's newest version, by section ID, in one query.
export async function latestVersions(
  assessment: Types.ObjectId,
): Promise<Map<string, SectionVersionDto>> {
  const newest = await ReportSectionVersionModel.aggregate<{ _id: string; latest: Version }>([
    { $match: { assessment } },
    { $sort: { sectionId: 1, version: -1 } },
    { $group: { _id: '$sectionId', latest: { $first: '$$ROOT' } } },
  ])
  return new Map(newest.map((n) => [n._id, toVersionDto(n.latest)]))
}

// Saves one section of the document as a new version (AC3, AC4, AC13, AC15).
// Only the assigned engineer can, while the assessment is not archived. The
// document must have been built on the section's saved draft (`draftId`)
// and on its newest version (`baseVersion`); otherwise nothing is saved and
// the engineer is asked to reload (409). In a drafted section, what changed
// in each finding is logged first (recordDocumentEdits): an edit (AC12) with
// its citations after it (AC9, AC10), or a reject for one deleted.
export async function saveSectionDocument(
  reference: string,
  sectionId: string,
  input: SaveDocumentInput,
  user: SessionUser,
): Promise<SectionVersionDto> {
  const assessment = await assessmentToDraft(reference, user)
  let cope: CopeDimension | 'all' = 'all'
  let draft: Draft | null = null
  if (sectionId === '2') draft = await summaryDraft(assessment._id)
  else if (!UNDRAFTED_PARTS.has(sectionId)) {
    const section = await templateSection(sectionId)
    if (section.cope_dimensions.length === 1) cope = section.cope_dimensions[0] as CopeDimension
    draft = (await sectionDrafts(assessment._id)).get(sectionId)?.saved ?? null
  }
  if ((draft ? String(draft._id) : null) !== input.draftId) throw new StaleDraftError()

  const latest = await ReportSectionVersionModel.findOne({ assessment: assessment._id, sectionId })
    .sort({ version: -1 })
    .lean<Version>()
  if ((latest?.version ?? 0) !== input.baseVersion) throw new StaleDocumentError()

  const { document } = input
  checkShape(document, draft)

  const at = new Date()
  // Section 2's statements are not reviewed one by one (GN-07): only 4-12 log.
  if (draft && sectionId !== '2') {
    const previous = latest && String(latest.draft) === String(draft._id) ? latest.document : null
    await recordDocumentEdits(draft, document, previous, user, at)
  }

  const site = assessment.site!
  try {
    const [saved] = await ReportSectionVersionModel.create([
      {
        assessment: assessment._id,
        sectionId,
        version: input.baseVersion + 1,
        draft: draft?._id ?? null,
        document,
        by: { id: user.id, name: user.name },
        at,
        metadata: {
          source_type: 'report_section_version',
          jurisdiction: site.jurisdiction,
          facility_type: site.facilityType,
          COPE_dimension: cope,
          effective_date: at,
        },
      },
    ])
    return toVersionDto(saved.toObject() as Version)
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new StaleDocumentError()
    throw error
  }
}
