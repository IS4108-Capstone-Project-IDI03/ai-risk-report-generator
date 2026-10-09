// IN-07: the admin's decision on a document that repeats or updates a stored
// one (keep both, discard, supersede, add as older), and the side-by-side
// comparison that informs it. Called by routes/knowledge-document.routes.ts.
// Calls the ingestion service (passages), S3 (the file) and MongoDB.
import { isValidObjectId, type HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { KnowledgeDocumentModel, type IKnowledgeDocument } from '../models/knowledge-document.model'
import { IngestionJobModel } from '../models/ingestion-job.model'
import {
  deletePassages,
  getComparison,
  IngestionUnavailableError,
  matchDocument,
  relabelPassages,
  type ComparisonRow,
} from './ingestion.service'
import {
  KnowledgeDocumentNotFoundError,
  KnowledgeDocumentWrongStateError,
  labels,
  needsReview,
  toDtoOf,
  toDtos,
  type KnowledgeDocumentDto,
} from './knowledge-document.service'
import * as storage from './storage.service'

export const DECISIONS = [
  'keep_both',
  'discard_new',
  'discard_other',
  'supersede',
  'add_as_older',
] as const
export type Decision = (typeof DECISIONS)[number]
export const decisionSchema = z.object({
  choice: z.enum(DECISIONS, 'Choose what to do with this document.'),
})

type Doc = HydratedDocument<IKnowledgeDocument>

// Refusals shown as-is by the review page. Each says what happened, then what to do.
const STALE = 'Refresh the page to see its current status.'
const SAVE_DETAILS_FIRST =
  "This document's details are not confirmed yet. Save them first, then decide."
const NO_MATCH = `This document has nothing left to decide. ${STALE}`
const OTHER_GONE = `The matched document was removed. ${STALE}`
const NOT_ALLOWED = `That choice doesn't fit this match. ${STALE}`
const NOT_UPDATED = "The knowledge base couldn't be updated, so nothing changed. Try again shortly."

// Clears a match that points at a removed document and relabels the passages
// (the label is `needs_review` while a match stands). Without this, the
// document would stay hidden from search with no Review button to free it.
async function dropDanglingMatch(doc: Doc): Promise<void> {
  await KnowledgeDocumentModel.updateOne({ _id: doc._id }, { $unset: { match: 1 } })
  doc.set('match', undefined)
  await relabelPassages(String(doc._id), labels(doc.toObject()), NOT_UPDATED)
}

// The reviewed document and the one its match points to. Throws
// KnowledgeDocumentNotFoundError, or KnowledgeDocumentWrongStateError when
// there is no match to look at or the matched document is gone; with
// `detailsMustBeSaved`, also when details are still Unconfirmed (IN-07 AC8).
async function loadPair(
  id: string,
  detailsMustBeSaved = false,
): Promise<{ document: Doc; other: Doc }> {
  if (!isValidObjectId(id)) throw new KnowledgeDocumentNotFoundError()
  const document = await KnowledgeDocumentModel.findById(id)
  if (!document) throw new KnowledgeDocumentNotFoundError()
  if (detailsMustBeSaved && document.unconfirmed?.length) {
    throw new KnowledgeDocumentWrongStateError(SAVE_DETAILS_FIRST)
  }
  if (!document.match) throw new KnowledgeDocumentWrongStateError(NO_MATCH)
  const other = await KnowledgeDocumentModel.findById(document.match.documentId)
  if (!other) {
    await dropDanglingMatch(document)
    throw new KnowledgeDocumentWrongStateError(OTHER_GONE)
  }
  return { document, other }
}

/**
 * Returns the reviewed document, the document it matches and their aligned
 * passages (IN-07 AC7). Throws KnowledgeDocumentNotFoundError,
 * KnowledgeDocumentWrongStateError (no match, or the matched document is gone)
 * or IngestionUnavailableError.
 */
export async function compareKnowledgeDocument(id: string): Promise<{
  document: KnowledgeDocumentDto
  matched: KnowledgeDocumentDto
  rows: ComparisonRow[]
}> {
  const { document, other } = await loadPair(id)
  const rows = await getComparison(id, String(other._id))
  const [dto, matched] = await toDtos([document.toObject(), other.toObject()])
  return { document: dto, matched, rows }
}

// The choices that fit this match (IN-07 Decision): every match can be kept or
// discarded; an edition can also be added, and a pair that both wait for a
// decision lets either be discarded.
function allowedChoices(document: Doc, other: Doc): Decision[] {
  const kind = document.match?.kind
  return [
    'keep_both',
    'discard_new',
    ...(kind === 'newer_edition' ? (['supersede'] as const) : []),
    ...(kind === 'earlier_edition' ? (['add_as_older'] as const) : []),
    ...(needsReview(other) ? (['discard_other'] as const) : []),
  ]
}

type Change = {
  doc: Doc
  set: Partial<Pick<IKnowledgeDocument, 'match' | 'withdrawn' | 'editionFamily'>>
}

// Saves each change, then puts the new labels on the passages of every
// document whose labels changed. If anything fails, writes the old values back
// (and re-sends the old labels, in case one relabel got through): without
// this, MongoDB would show the decision while search still used the old status.
async function saveAndRelabel(changes: Change[]): Promise<void> {
  const snapshot = ({ doc }: Change) => {
    const { match, withdrawn, editionFamily } = doc.toObject()
    return { match, withdrawn, editionFamily }
  }
  const before = changes.map((change) => ({
    old: snapshot(change),
    labels: labels(change.doc.toObject()),
  }))
  try {
    for (const { doc, set } of changes) {
      for (const [field, value] of Object.entries(set)) doc.set(field, value)
      await doc.save()
    }
    for (const [i, { doc }] of changes.entries()) {
      const now = labels(doc.toObject())
      if (JSON.stringify(now) === JSON.stringify(before[i].labels)) continue
      await relabelPassages(String(doc._id), now, NOT_UPDATED)
    }
  } catch (error) {
    for (const [i, { doc }] of changes.entries()) {
      for (const [field, value] of Object.entries(before[i].old)) doc.set(field, value)
      await doc.save()
      await relabelPassages(String(doc._id), before[i].labels, NOT_UPDATED).catch(() => undefined)
    }
    throw error
  }
}

// Removes a document completely, in order: passages, file, ingestion job, record.
// Passages go first so that if Chroma is down nothing has changed yet (a 503);
// each step is safe to repeat, so the admin can retry after a later failure.
// Then every document that pointed at it is matched again.
async function discard(doc: Doc): Promise<void> {
  await deletePassages(String(doc._id))
  try {
    await storage.deleteObject(doc.file.key)
  } catch (error) {
    console.error('Deleting the file failed:', error)
    throw new IngestionUnavailableError(
      "The file couldn't be removed from storage, so the document was not discarded. Try again shortly.",
    )
  }
  await IngestionJobModel.deleteMany({ documentId: doc._id })
  await KnowledgeDocumentModel.deleteOne({ _id: doc._id })

  // A document that matched the discarded one may now match nothing. If
  // matching it again fails, drop its match and relabel it: without this it
  // would keep a match to a removed document, hidden from search with no
  // Review button. The discard itself is done either way.
  const pointing = await KnowledgeDocumentModel.find({ 'match.documentId': doc._id })
  await Promise.all(
    pointing.map(async (dependent) => {
      try {
        await matchDocument(String(dependent._id))
      } catch (error) {
        console.error('Matching after a discard failed:', error)
        await dropDanglingMatch(dependent).catch((e) =>
          console.error('Clearing the match after a discard failed:', e),
        )
      }
    }),
  )
}

/**
 * Returns the reviewed document after the decision, or null when it was
 * discarded (IN-07 AC8–13). Throws KnowledgeDocumentNotFoundError,
 * KnowledgeDocumentWrongStateError (details Unconfirmed, no match, the matched
 * document gone, or a choice that does not fit) or IngestionUnavailableError,
 * in which case nothing changed.
 */
export async function decideKnowledgeDocument(
  id: string,
  choice: Decision,
  by: { id: string; name: string },
): Promise<KnowledgeDocumentDto | null> {
  // a. Find both documents and check the decision still makes sense.
  const { document, other } = await loadPair(id, true)
  if (!allowedChoices(document, other).includes(choice)) {
    throw new KnowledgeDocumentWrongStateError(NOT_ALLOWED)
  }
  // True when the other document's own match points back here (both in one batch).
  const otherPointsHere = other.match && String(other.match.documentId) === String(document._id)
  const clearOther: Change[] = otherPointsHere ? [{ doc: other, set: { match: null } }] : []

  // Replacing must leave one active edition: refused while another member of
  // the stored edition's family is still active (the reinstate rule, AC15).
  if (choice === 'supersede' && other.editionFamily) {
    const active = await KnowledgeDocumentModel.findOne({
      editionFamily: other.editionFamily,
      _id: { $nin: [other._id, document._id] },
      withdrawn: { $exists: false },
    }).lean()
    if (active) {
      const edition = active.edition ? ` (${active.edition} edition)` : ''
      throw new KnowledgeDocumentWrongStateError(`Withdraw ${active.title}${edition} first.`)
    }
  }

  // b. Do it.
  if (choice === 'discard_new') {
    await discard(document)
    return null
  }
  if (choice === 'discard_other') {
    await discard(other)
    return toDtoOf((await KnowledgeDocumentModel.findById(id).lean()) ?? document.toObject())
  }
  if (choice === 'keep_both') {
    // The reviewed document takes the matched one's status: next to a withdrawn
    // document it is withdrawn too, in the same edition family (if any).
    const status: Change['set'] = other.withdrawn
      ? {
          withdrawn: { at: new Date(), by },
          ...(other.editionFamily ? { editionFamily: other.editionFamily } : {}),
        }
      : {}
    await saveAndRelabel([{ doc: document, set: { match: null, ...status } }, ...clearOther])
  } else {
    // supersede and add_as_older put both in one edition family: the stored
    // document's own, or its id if it had none. The older edition is withdrawn
    // (who and when recorded, as KB-01); one already withdrawn keeps its record.
    const editionFamily = other.editionFamily ?? other._id
    const withdrawal = { at: new Date(), by }
    const older = choice === 'supersede' ? other : document
    const change = (doc: Doc, set: Change['set']): Change => ({
      doc,
      set: {
        editionFamily,
        ...(doc === older ? { withdrawn: doc.withdrawn ?? withdrawal } : {}),
        ...set,
      },
    })
    await saveAndRelabel([
      change(document, { match: null }),
      change(other, otherPointsHere ? { match: null } : {}),
    ])
  }
  return toDtoOf(document.toObject())
}
