// Review decisions on report section drafts (RV-02): accepting, editing,
// rejecting and restoring each generated finding, Bulk accept, and
// regenerating a section as a replacement draft to accept or discard.
//
// A finding is one statement of a draft. Drafts are never changed: every
// decision is one entry added to the review audit log, and a finding's state
// and text are read back from the log (foldFindings). A decision is applied
// only to the section's saved draft the engineer was looking at, and only by
// the assessment's assigned engineer while it is not archived.
// Called by routes/assessment.routes.ts; review.service reads the states.
import type { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { ReviewAuditModel, type IReviewAuditEntry } from '../models/review-audit.model'
import { isDuplicateKeyError } from './mongo-errors'
import {
  assessmentToDraft,
  sectionDrafts,
  templateSection,
  writeDraft,
  type Draft,
} from './section.service'

export const FINDING_STATES = ['pending', 'accepted', 'edited', 'rejected'] as const
export type FindingState = (typeof FINDING_STATES)[number]

export const MAX_FINDING_LENGTH = 2000
export const MAX_INSTRUCTION_LENGTH = 1000

export class NotDraftedError extends Error {
  constructor(sectionId: string) {
    super(`Section ${sectionId} has no draft to review yet. Draft it on the Generation tab first.`)
    this.name = 'NotDraftedError'
  }
}
export class StaleDraftError extends Error {
  constructor() {
    super(
      "This section's saved draft has changed since you opened it. Reload the review workspace and decide again.",
    )
    this.name = 'StaleDraftError'
  }
}
export class FindingNotFoundError extends Error {
  constructor(key: string) {
    super(`Finding ${key} is not in this draft.`)
    this.name = 'FindingNotFoundError'
  }
}
// The decision does not apply to the finding as it stands, e.g. editing a
// rejected finding.
export class FindingStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FindingStateError'
  }
}
export class ConcurrentDecisionError extends Error {
  constructor() {
    super(
      'Another decision on this finding was saved at the same moment. Reload the review workspace to see where it stands.',
    )
    this.name = 'ConcurrentDecisionError'
  }
}
export class ReplacementPendingError extends Error {
  constructor() {
    super(
      'A replacement draft of this section is waiting. Accept or discard it before regenerating the section again.',
    )
    this.name = 'ReplacementPendingError'
  }
}
export class ReplacementNotFoundError extends Error {
  constructor(sectionId: string) {
    super(
      `No replacement draft of section ${sectionId} is waiting for a decision. It may have been accepted or discarded already: reload the review workspace.`,
    )
    this.name = 'ReplacementNotFoundError'
  }
}

// Which draft a decision is about: the one the engineer was looking at.
export const draftChoiceSchema = z.object({
  draftId: z.string('Say which draft the decision is about.').min(1),
})
// The body of PUT …/findings/:finding: the engineer's wording, which replaces
// the finding's text in the draft (AC2). Its citations stay with it.
export const findingEditSchema = draftChoiceSchema.extend({
  text: z
    .string('Write the finding.')
    .trim()
    .min(1, 'Write the finding, or reject it instead.')
    .max(
      MAX_FINDING_LENGTH,
      `A finding must be ${MAX_FINDING_LENGTH.toLocaleString('en-GB')} characters or fewer.`,
    ),
})
// The body of POST …/regenerate: what the engineer wants changed, if anything.
export const regenerateSchema = z.object({
  instruction: z
    .string()
    .trim()
    .max(
      MAX_INSTRUCTION_LENGTH,
      `The instruction must be ${MAX_INSTRUCTION_LENGTH.toLocaleString('en-GB')} characters or fewer.`,
    )
    .nullish()
    .transform((value) => value || null),
})

export type ReviewEntry = IReviewAuditEntry & { _id: Types.ObjectId }
type Stamp = { at: Date; by: { id: string; name: string } }

// Where one finding of a draft stands.
export type Finding = {
  // `<subsection index>.<statement index>`, as the log and the routes name it.
  key: string
  heading: string
  // What the draft says, and the text now: the engineer's if they edited it.
  generatedText: string
  text: string
  citations: string[]
  supported: boolean
  state: FindingState
  // The latest decision on it; null while none has been made.
  decided: Stamp | null
  // What Restore returns a rejected finding to: its state before rejection.
  restoresTo: Exclude<FindingState, 'rejected'>
  // The sequence number the next decision on it takes.
  next: number
}

// A draft's findings in the template's order, with the decisions in the log
// applied in the order they were made.
export function foldFindings(draft: Draft, entries: readonly ReviewEntry[]): Finding[] {
  const findings = new Map<string, Finding>()
  draft.subsections.forEach((sub, i) =>
    sub.statements.forEach((statement, j) => {
      const key = `${i}.${j}`
      findings.set(key, {
        key,
        heading: sub.heading,
        generatedText: statement.text,
        text: statement.text,
        citations: statement.citations,
        supported: statement.supported,
        state: 'pending',
        decided: null,
        restoresTo: 'pending',
        next: 0,
      })
    }),
  )
  const decisions = entries
    .filter((e) => e.finding && String(e.draft) === String(draft._id))
    .sort((a, b) => a.sequence - b.sequence)
  for (const e of decisions) {
    const finding = findings.get(e.finding!)
    if (!finding) continue
    finding.next = Math.max(finding.next, e.sequence + 1)
    finding.decided = { at: e.at, by: { id: e.by.id, name: e.by.name } }
    if (e.action === 'accept') finding.state = 'accepted'
    else if (e.action === 'edit') {
      finding.text = e.after ?? finding.text
      finding.state = 'edited'
    } else if (e.action === 'reject') {
      if (finding.state !== 'rejected') finding.restoresTo = finding.state
      finding.state = 'rejected'
    } else if (e.action === 'restore') finding.state = finding.restoresTo
  }
  return [...findings.values()]
}

// How many of a draft's findings stand in each state (AC9).
export type FindingCounts = { total: number } & Record<FindingState, number>
export function countFindings(findings: readonly Finding[]): FindingCounts {
  const counts: FindingCounts = { total: 0, pending: 0, accepted: 0, edited: 0, rejected: 0 }
  for (const f of findings) {
    counts.total += 1
    counts[f.state] += 1
  }
  return counts
}

// The log's entries about these drafts, in one query.
export async function entriesFor(drafts: Types.ObjectId[]): Promise<ReviewEntry[]> {
  if (!drafts.length) return []
  return await ReviewAuditModel.find({ draft: { $in: drafts } }).lean<ReviewEntry[]>()
}

// Every entry about an assessment's sections, newest first.
export async function assessmentHistory(assessment: Types.ObjectId): Promise<ReviewEntry[]> {
  return await ReviewAuditModel.find({ assessment }).sort({ at: -1, _id: -1 }).lean<ReviewEntry[]>()
}

// A new log entry about a draft, by the signed-in user (AC4). Its labels come
// from the draft, which took them from the site and the section.
function entry(
  draft: Draft,
  user: SessionUser,
  fields: Pick<IReviewAuditEntry, 'action' | 'sequence'> & Partial<IReviewAuditEntry>,
  at = new Date(),
): IReviewAuditEntry {
  return {
    assessment: draft.assessment,
    sectionId: draft.sectionId,
    draft: draft._id,
    finding: null,
    heading: null,
    before: null,
    after: null,
    citations: [],
    instruction: null,
    bulk: false,
    by: { id: user.id, name: user.name },
    at,
    metadata: {
      source_type: 'review_decision',
      jurisdiction: draft.metadata.jurisdiction,
      facility_type: draft.metadata.facility_type,
      COPE_dimension: draft.metadata.COPE_dimension,
      effective_date: at,
    },
    ...fields,
  }
}

// Adds one entry. A clash on its sequence means another decision on the same
// finding or draft was saved first.
async function append(record: IReviewAuditEntry) {
  try {
    await ReviewAuditModel.create(record)
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new ConcurrentDecisionError()
    throw error
  }
}

// The section's saved draft and its findings, for a decision the engineer
// made while looking at `draftId`. The template is checked first, so nothing
// is saved while the workspace could not be shown afterwards.
async function decidable(
  reference: string,
  sectionId: string,
  draftId: string,
  user: SessionUser,
): Promise<{ draft: Draft; findings: Finding[] }> {
  const assessment = await assessmentToDraft(reference, user)
  await templateSection(sectionId)
  const { saved } = (await sectionDrafts(assessment._id)).get(sectionId) ?? { saved: null }
  if (!saved) throw new NotDraftedError(sectionId)
  if (String(saved._id) !== draftId) throw new StaleDraftError()
  return { draft: saved, findings: foldFindings(saved, await entriesFor([saved._id])) }
}

export type FindingDecision =
  | { action: 'accept' }
  | { action: 'edit'; text: string }
  | { action: 'reject' }
  | { action: 'restore' }

const REJECTED =
  'This finding was rejected, so it is not in the draft. Restore it from the review history first.'

// Accepts (AC1), edits (AC2-AC4), rejects (AC5, AC6) or restores one finding
// of the section's saved draft. An edited finding can then be accepted too,
// keeping the engineer's wording. A decision that changes nothing, such as
// accepting an accepted finding or saving an edit with the same text, records
// nothing, so a double click is harmless.
export async function decideFinding(
  reference: string,
  sectionId: string,
  key: string,
  draftId: string,
  decision: FindingDecision,
  user: SessionUser,
): Promise<void> {
  const { draft, findings } = await decidable(reference, sectionId, draftId, user)
  const finding = findings.find((f) => f.key === key)
  if (!finding) throw new FindingNotFoundError(key)

  if (decision.action === 'accept' || decision.action === 'edit') {
    if (finding.state === 'rejected') throw new FindingStateError(REJECTED)
  }
  const unchanged = {
    accept: finding.state === 'accepted',
    edit: decision.action === 'edit' && decision.text === finding.text,
    reject: finding.state === 'rejected',
    restore: finding.state !== 'rejected',
  }[decision.action]
  if (unchanged) return

  await append(
    entry(draft, user, {
      action: decision.action,
      finding: key,
      sequence: finding.next,
      heading: finding.heading,
      // The text as it stood: what was accepted, edited or rejected (AC3, AC6).
      before: finding.text,
      after: decision.action === 'edit' ? decision.text : null,
      citations: finding.citations,
    }),
  )
}

// Bulk accept (AC7): every pending finding of the section's saved draft
// becomes Accepted, one entry each. Rejected and edited findings keep their
// decisions (AC8). A finding decided by another request at the same moment
// keeps that decision. Returns how many were accepted.
export async function bulkAccept(
  reference: string,
  sectionId: string,
  draftId: string,
  user: SessionUser,
): Promise<number> {
  const { draft, findings } = await decidable(reference, sectionId, draftId, user)
  const pending = findings.filter((f) => f.state === 'pending')
  if (!pending.length) return 0
  const at = new Date()
  try {
    await ReviewAuditModel.insertMany(
      pending.map((f) =>
        entry(
          draft,
          user,
          {
            action: 'accept',
            finding: f.key,
            sequence: f.next,
            heading: f.heading,
            before: f.text,
            citations: f.citations,
            bulk: true,
          },
          at,
        ),
      ),
      { ordered: false },
    )
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
  }
  return pending.length
}

// Regenerates one section (AC10): drafts it again through S4 as a
// replacement for its saved draft, which stays the section's content, with
// every decision on it, until the replacement is accepted. S4 is given the
// saved draft's findings with the engineer's decision on each, and what they
// asked to change. Other sections are untouched. One replacement waits at a
// time.
export async function regenerateSection(
  reference: string,
  sectionId: string,
  instruction: string | null,
  user: SessionUser,
): Promise<void> {
  const assessment = await assessmentToDraft(reference, user)
  const section = await templateSection(sectionId)
  const { saved, replacement } = (await sectionDrafts(assessment._id)).get(sectionId) ?? {
    saved: null,
    replacement: null,
  }
  if (!saved) throw new NotDraftedError(sectionId)
  if (replacement) throw new ReplacementPendingError()

  const findings = foldFindings(saved, await entriesFor([saved._id]))
  const draft = await writeDraft(assessment, section, user, {
    replacementFor: saved._id,
    instruction,
    current: findings.map((f) => ({ heading: f.heading, text: f.text, decision: f.state })),
  })
  await append(entry(draft, user, { action: 'regenerate', sequence: 0, instruction }))
}

// Accepts a waiting replacement draft (AC11), which becomes the section's
// saved content with every finding pending, or discards it (AC12), leaving
// the saved draft and its decisions as they were.
export async function decideReplacement(
  reference: string,
  sectionId: string,
  draftId: string,
  accept: boolean,
  user: SessionUser,
): Promise<void> {
  const assessment = await assessmentToDraft(reference, user)
  await templateSection(sectionId)
  const { replacement } = (await sectionDrafts(assessment._id)).get(sectionId) ?? {
    replacement: null,
  }
  if (!replacement || String(replacement._id) !== draftId)
    throw new ReplacementNotFoundError(sectionId)
  // After the entry asking for it, so of an accept and a discard sent at once
  // only one is saved.
  const sequence = (await entriesFor([replacement._id]))
    .filter((e) => !e.finding)
    .reduce((next, e) => Math.max(next, e.sequence + 1), 0)
  await append(
    entry(replacement, user, {
      action: accept ? 'accept_replacement' : 'discard_replacement',
      sequence,
      instruction: replacement.provenance.instruction ?? null,
    }),
  )
}
