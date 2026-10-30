// A report section's version history (RV-06): every AI draft it has had and
// every version of it saved in the document editor (RV-08), oldest first, each
// with its text and who made it when; and restoring one of them as the
// section's text.
//
// A restore never changes what it restores, nor any other section (AC7). It
// is a save like the document editor's: a new version holding the restored
// text, built on the section's saved draft and newest version, and, in a
// drafted section (4-12), the review log entries that bring each finding to
// the restored words (an edit back, a reject for one the text lacks, a
// restore for a rejected one it holds). The new version and those entries
// name what was restored in `restoredFrom`. The section reads the restored
// text from then on (AC6, AC8), and the text it replaced stays in the
// history, so a restore can itself be undone.
// Called by routes/assessment.routes.ts.
import type { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import {
  RESTORED_FROM,
  ReportSectionVersionModel,
  type SectionDocument,
} from '../models/report-section-version.model'
import { UserModel } from '../models/user.model'
import {
  assessmentIdOf,
  StaleDocumentError,
  UNDRAFTED_PARTS,
  writeSectionVersion,
  type SectionVersionDto,
  type Version,
} from './report-document.service'
import { entriesFor, foldFindings } from './review-decision.service'
import { draftDocument, ontoDraft } from './section-document'
import { savedDraftTimeline, UnknownSectionError, type SavedDraft } from './section.service'

// The report's sections by ID: 1 to 12, and Appendix A.
const SECTION_ID = /^(1[0-2]|[1-9]|A)$/

export class VersionNotFoundError extends Error {
  constructor(from: string) {
    super(
      `${from.startsWith('version:') ? `Version ${from.slice(8)}` : 'That AI draft'} is not in this section's version history. Reload the version history and choose again.`,
    )
    this.name = 'VersionNotFoundError'
  }
}

// How an entry came to be the section's text: an AI draft drafted first,
// drafted again, or a replacement accepted (RV-02); a version saved from the
// document editor, or made by restoring an earlier one.
export type VersionOrigin = 'drafted' | 'redrafted' | 'replacement' | 'saved' | 'restored'

// One entry of a section's version history.
export type HistoryEntryDto = {
  // `version:<n>` for a saved version, `draft:<_id>` for an AI draft: what a
  // restore names.
  id: string
  kind: 'version' | 'draft'
  // A saved version's number; null for a draft.
  version: number | null
  // The draft whose findings its finding keys name: a draft's own `_id`, the
  // draft a version was edited from, or null for text written with none.
  draftId: string | null
  // Made on the section's saved draft (or, for a section with none, written
  // without one), so its findings are the section's findings now. Restoring
  // one that was not carries its text onto the saved draft.
  onSavedDraft: boolean
  origin: VersionOrigin
  // What a restored version restored, as its id; null otherwise.
  restoredFrom: string | null
  // The section's text as it then stood (AC3-AC5 compare it): a version's as
  // saved, a draft's as drafted, with the edits of any findings kept from
  // the draft before.
  document: SectionDocument
  // When it became the section's text (AC1, AC2): a version's save, a
  // draft's drafting, a replacement's acceptance.
  at: Date
  // Who (AC2): who saved a version, who drafted a draft, who accepted a
  // replacement. null for a draft whose engineer has no account any more.
  by: { id: string; name: string } | null
  // The model that wrote a draft; null for a version.
  model: string | null
}

export type SectionHistoryDto = {
  sectionId: string
  // Oldest first (AC1).
  entries: HistoryEntryDto[]
  // What a restore is built on, as a save from the document editor is: the
  // newest version's number (0 for none) and the saved draft's `_id`.
  latestVersion: number
  savedDraftId: string | null
}

// The body of POST …/sections/:sectionId/versions/restore: which entry to
// restore, and the newest version and saved draft the engineer saw.
export const restoreVersionSchema = z.strictObject({
  baseVersion: z.number().int().min(0),
  draftId: z.string().min(1).nullable(),
  from: z.string().regex(RESTORED_FROM, 'Say which version to restore.'),
})
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>

// Each draft's text as it read when it became the section's saved content,
// by `_id`: its statements, with the decisions copied onto it from the draft
// before (a finding kept word for word, with the engineer's edit). Decisions
// made on it since are not part of it.
async function draftTexts(timeline: SavedDraft[]): Promise<Map<string, SectionDocument>> {
  const carried = (await entriesFor(timeline.map((t) => t.draft._id))).filter((e) => e.carriedFrom)
  return new Map(
    timeline.map(({ draft }) => [
      String(draft._id),
      draftDocument(draft, foldFindings(draft, carried)),
    ]),
  )
}

// Engineers' names by account `_id`.
async function namesOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const users = await UserModel.find({ _id: { $in: ids } }, 'name').lean()
  return new Map(users.map((u) => [String(u._id), u.name]))
}

// A section's version history (AC1, AC2): its AI drafts and saved versions,
// oldest first, each with its text, who made it and when. Anyone who can view
// the assessment may read it. Sections 1, 3 and A have no drafts, only what
// the engineer wrote into them.
export async function sectionHistory(
  reference: string,
  sectionId: string,
): Promise<SectionHistoryDto> {
  if (!SECTION_ID.test(sectionId)) throw new UnknownSectionError(sectionId)
  const assessment = await assessmentIdOf(reference)
  const [timeline, versions] = await Promise.all([
    UNDRAFTED_PARTS.has(sectionId)
      ? Promise.resolve<SavedDraft[]>([])
      : savedDraftTimeline(assessment, sectionId),
    ReportSectionVersionModel.find({ assessment, sectionId })
      .sort({ version: 1 })
      .lean<Version[]>(),
  ])
  const [texts, names] = await Promise.all([
    draftTexts(timeline),
    namesOf(timeline.filter((t) => !t.acceptedBy).map((t) => t.draft.createdBy)),
  ])
  const savedDraftId = timeline.length ? String(timeline[timeline.length - 1].draft._id) : null

  const drafts = timeline.map(({ draft, since, acceptedBy }, i): HistoryEntryDto => {
    const id = String(draft._id)
    const name = names.get(String(draft.createdBy))
    return {
      id: `draft:${id}`,
      kind: 'draft',
      version: null,
      draftId: id,
      onSavedDraft: id === savedDraftId,
      origin: draft.replacementFor ? 'replacement' : i === 0 ? 'drafted' : 'redrafted',
      restoredFrom: null,
      document: texts.get(id)!,
      at: since,
      by: acceptedBy ?? (name ? { id: String(draft.createdBy), name } : null),
      model: draft.provenance.model,
    }
  })
  const saves = versions.map((v): HistoryEntryDto => {
    const draftId = v.draft ? String(v.draft) : null
    return {
      id: `version:${v.version}`,
      kind: 'version',
      version: v.version,
      draftId,
      onSavedDraft: draftId === savedDraftId,
      origin: v.restoredFrom ? 'restored' : 'saved',
      restoredFrom: v.restoredFrom ?? null,
      document: v.document,
      at: v.at,
      by: { id: v.by.id, name: v.by.name },
      model: null,
    }
  })
  return {
    sectionId,
    // A stable sort: of a draft and a version made in the same millisecond,
    // the draft comes first, and versions keep their numbers' order.
    entries: [...drafts, ...saves].sort((a, b) => a.at.getTime() - b.at.getTime()),
    latestVersion: versions.length ? versions[versions.length - 1].version : 0,
    savedDraftId,
  }
}

// The text of the entry `from` names, and the draft its finding keys name.
async function sourceOf(
  assessment: Types.ObjectId,
  sectionId: string,
  from: string,
): Promise<{ document: SectionDocument; draftId: string | null }> {
  const ref = from.slice(from.indexOf(':') + 1)
  if (from.startsWith('version:')) {
    const version = await ReportSectionVersionModel.findOne({
      assessment,
      sectionId,
      version: Number(ref),
    }).lean<Version>()
    if (!version) throw new VersionNotFoundError(from)
    return { document: version.document, draftId: version.draft ? String(version.draft) : null }
  }
  // Only a draft that has been the section's saved content is in its history.
  const found = UNDRAFTED_PARTS.has(sectionId)
    ? undefined
    : (await savedDraftTimeline(assessment, sectionId)).find((t) => String(t.draft._id) === ref)
  if (!found) throw new VersionNotFoundError(from)
  return { document: (await draftTexts([found])).get(ref)!, draftId: ref }
}

// Restores one entry of the section's version history as its text (AC6): a
// new version holding it, built on the saved draft and newest version the
// engineer saw (else 409, as for a save). Only the assigned engineer can,
// while the assessment is not archived. Text written on another draft is
// carried onto the saved draft (ontoDraft): its passages that are still
// findings stay findings, the rest is the engineer's own. In a drafted
// section the saved draft's findings follow it: one the text lacks is taken
// out, one rejected since that it holds comes back, and one worded otherwise
// is edited back, each a review log entry naming the restore. No other
// section changes (AC7); the version is saved, so the text stays (AC8).
export async function restoreSectionVersion(
  reference: string,
  sectionId: string,
  input: RestoreVersionInput,
  user: SessionUser,
): Promise<SectionVersionDto> {
  if (!SECTION_ID.test(sectionId)) throw new UnknownSectionError(sectionId)
  try {
    return await writeSectionVersion(
      reference,
      sectionId,
      input,
      user,
      async (draft, assessment) => {
        const source = await sourceOf(assessment, sectionId, input.from)
        const findings = draft ? foldFindings(draft, await entriesFor([draft._id])) : []
        const sameDraft = source.draftId === (draft ? String(draft._id) : null)
        return ontoDraft(source.document, sameDraft, draft, findings)
      },
      input.from,
    )
  } catch (error) {
    if (error instanceof StaleDocumentError)
      throw new StaleDocumentError(
        'This section was saved again after you opened its version history. Reload the version history to see the newer version, then restore again.',
      )
    throw error
  }
}
