// Who an assessment is for (RV-11): the picker's list, the engineer chosen when an
// admin creates assessments, and reassigning one later. Called by
// routes/assessment.routes.ts and assessment-batch.service.ts. Calls
// notification.service.ts to tell the people involved.
import { isValidObjectId, Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { UserModel, type UserRole } from '../models/user.model'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { listAssessments, type AssessmentDto } from './assessment.service'
import type { SessionUser } from './auth.service'
import { createNotification, audienceOf, removeAssessmentItems } from './notification.service'
import { hasPermission } from './permissions.service'
import type { NewAssessments } from './assessment-batch.service'

/** An account someone may be assigned to. `role` is the stored value; the client turns it into words. */
export type AssignableEngineer = { id: string; name: string; role: UserRole }

/** Returns the active accounts by name, the caller included: who an assessment can go to. */
export async function listAssignableEngineers(): Promise<AssignableEngineer[]> {
  const accounts = await UserModel.find({ active: true }, 'name role')
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean()
  return accounts.map((a) => ({ id: String(a._id), name: a.name, role: a.role }))
}

// A request value that names no active account, e.g. { engineerId: "..." }.
// The route answers 400 with it.
export class UnknownEngineerError extends Error {
  constructor() {
    super('Choose an active account.')
    this.name = 'UnknownEngineerError'
  }
}

// Another admin moved the assessment between this one's read and write. The route
// answers 409 so the admin reloads and sees who has it now.
export class AssessmentReassignedError extends Error {
  constructor() {
    super('This assessment was just reassigned. Reload and try again.')
    this.name = 'AssessmentReassignedError'
  }
}

// An id string in the form the database prints it, so it compares with String(_id).
const canonical = (id: string) => String(new Types.ObjectId(id))

// The active account with this id, or undefined.
async function activeAccount(id: unknown) {
  if (typeof id !== 'string' || !isValidObjectId(id)) return undefined
  return (await UserModel.findOne({ _id: id, active: true }, 'name').lean()) ?? undefined
}

/**
 * Settles who each assessment on a create form is for, by the form's refs.
 * Someone with assessments:assign must choose an active account for every
 * assessment; anyone else gets themselves, whatever the form says, so an
 * engineer can never create work for another. Returns the engineers and the
 * problems, naming each bad `sites.i.assessments.j.engineerId` in `fields`, for
 * the caller to refuse before anything is written.
 */
export async function assignedEngineers(
  input: NewAssessments,
  user: SessionUser,
): Promise<{
  engineers: Record<string, { id: string }>
  fields: Record<string, string>
}> {
  const chosen: Record<string, { id: string }> = {}
  const fields: Record<string, string> = {}
  if (!hasPermission(user.role, 'assessments:assign')) {
    for (const site of input.sites)
      for (const visit of site.assessments) chosen[visit.ref] = { id: user.id }
    return { engineers: chosen, fields }
  }
  // One query for every engineer on the form, rather than one per assessment.
  const ids = input.sites
    .flatMap((site) => site.assessments.map((v) => v.engineerId))
    .filter((id): id is string => !!id && isValidObjectId(id))
  const active = new Set(
    (await UserModel.find({ _id: { $in: ids }, active: true }, '_id').lean()).map((a) =>
      String(a._id),
    ),
  )
  for (const [i, site] of input.sites.entries()) {
    for (const [j, visit] of site.assessments.entries()) {
      const id =
        visit.engineerId && isValidObjectId(visit.engineerId) ? canonical(visit.engineerId) : ''
      if (active.has(id)) chosen[visit.ref] = { id }
      else
        fields[`sites.${i}.assessments.${j}.engineerId`] = visit.engineerId
          ? 'Choose an active account.'
          : 'Choose the assigned engineer.'
    }
  }
  return { engineers: chosen, fields }
}

// What the engineer sees on an "assigned" row: which assessment, for whom, where,
// when it is due and who sent it. Every value is a string (a notification's
// context is a string map); the client lays the row out from it.
// shortcut: `reportDue` is a snapshot of the report due date when the item was
// made, so a later edit to the date does not change the row. Upgrade by reading
// the date from the assessment when the Inbox is listed, if that matters.
function assignedContext(dto: AssessmentDto, sender: string): Record<string, string> {
  const context: Record<string, string> = {
    reference: dto.reference,
    assessmentId: dto.id,
    client: dto.client,
    site: dto.site.name,
    sender,
  }
  if (dto.reportDueDate) context.reportDue = dto.reportDueDate
  return context
}

// Sends the "assigned" Inbox item to an engineer who is not the person doing the
// assigning: your own action never notifies you. Never throws: the assessment is
// saved, and without the catch a notification error would report a failure for work
// that is done.
// shortcut: a failed notification is logged and lost, like every notification here (see notifyQuietly in knowledge-gap.service.ts), upgrade to an outbox if a missed Inbox item ever costs real work.
async function tellAssigned(dto: AssessmentDto, engineerId: string, sender: SessionUser) {
  if (engineerId === sender.id) return
  try {
    const to = await audienceOf(engineerId)
    if (!to) return
    await createNotification({
      purpose: 'assessment_assigned',
      message: `New assessment: ${dto.site.name}`,
      ...to,
      context: assignedContext(dto, sender.name),
      createdBy: sender.id,
    })
  } catch (error) {
    console.error('Could not create the assignment notification:', error)
  }
}

/** Tells each engineer an admin assigned an assessment to, once a create has succeeded. */
export async function tellAssignedEngineers(
  created: AssessmentDto[],
  engineers: Record<string, { id: string }>,
  assessmentIds: Record<string, string>,
  sender: SessionUser,
) {
  for (const [ref, engineer] of Object.entries(engineers)) {
    const dto = created.find((a) => a.id === assessmentIds[ref])
    if (dto) await tellAssigned(dto, engineer.id, sender)
  }
}

/**
 * Moves an assessment to another engineer (RV-11) and returns its row as the
 * Assessments list shows it. Its observations, drafts and costs stay with the
 * assessment: they hang off it, not off the engineer. Throws
 * AssessmentNotFoundError (404), AssessmentArchivedError (409),
 * AssessmentReassignedError (409, another admin moved it first) and
 * UnknownEngineerError (400). Naming the engineer it already has changes and
 * sends nothing.
 *
 * Steps: a. find it, b. check the new engineer, c. move it, d. tell people.
 */
export async function reassignAssessment(
  reference: string,
  engineerId: unknown,
  admin: SessionUser,
): Promise<AssessmentDto> {
  // a. Find it.
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  // b. Check the new engineer.
  const account = await activeAccount(engineerId)
  if (!account) throw new UnknownEngineerError()
  const previous = assessment.engineer ? String(assessment.engineer) : null
  const next = String(account._id)
  let moved = false
  if (previous !== next) {
    // c. Move it. Matching on archivedAt stops a move that raced an archive, and on
    // the engineer we read stops one that raced another reassign: without it, both
    // admins succeed and the first one's new engineer keeps an Inbox item.
    const result = await AssessmentModel.updateOne(
      {
        _id: assessment._id,
        archivedAt: { $exists: false },
        engineer: assessment.engineer ?? null, // null also matches a missing field
      },
      { engineer: account._id },
    )
    moved = !!result.modifiedCount
    if (!moved) {
      // Nothing matched: read again to say why. Already the target means a racing
      // move chose the same person, so there is nothing to tell anyone.
      const now = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
      if (now?.archivedAt) throw new AssessmentArchivedError(reference)
      if (String(now?.engineer ?? '') !== next) throw new AssessmentReassignedError()
    }
  }
  const row = await rowOf(reference, admin)
  // d. Tell people.
  if (moved) await tellReassigned(row, previous, account, admin)
  return row
}

// The assessment as the Assessments list shows it, for the user who asked.
async function rowOf(reference: string, user: SessionUser) {
  const row = (await listAssessments(user, { reference }))[0]
  if (!row) throw new AssessmentNotFoundError(reference)
  return row
}

// Tells the new engineer, tells the old one, and takes the old one's Inbox items
// for it away. Never throws, for the reason given at tellAssigned.
async function tellReassigned(
  row: AssessmentDto,
  previous: string | null,
  next: { _id: unknown; name: string },
  admin: SessionUser,
) {
  try {
    await tellAssigned(row, String(next._id), admin)
    if (!previous) return
    await removeAssessmentItems(row.reference, previous)
    // Your own action never notifies you: no bell for the old engineer who is the admin.
    const to = previous === admin.id ? null : await audienceOf(previous)
    if (!to) return
    await createNotification({
      purpose: 'assessment_moved',
      message: `${row.reference} moved to ${next.name}`,
      ...to,
      context: { reference: row.reference, sender: admin.name, newEngineer: next.name },
      createdBy: admin.id,
    })
  } catch (error) {
    console.error('Could not create the reassignment notifications:', error)
  }
}
