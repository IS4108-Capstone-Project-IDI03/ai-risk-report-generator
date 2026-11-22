// F-12: makes, resets and removes a user's practice assessment (ADR 0003).
// Called by routes/walkthrough.routes.ts and by the signed-in-user route (first sign-in).
// Calls records.ts (which writes from the template), the assessment and user settings
// models, and MarshBot's re-check. Nothing here calls AI, notifies anyone or queues an AI job.
import { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { UserSettingsModel } from '../../models/user-settings.model'
import { insertWithNextCode, pad } from '../assessment.service'
import type { SessionUser } from '../auth.service'
import { refreshBrief } from '../assistant/recheck.service'
import { locationKey } from '../location.service'
import { duplicateKeyField } from '../mongo-errors'
import { PRACTICE_PREFIX } from './filter'
import { fillPractice, removeMade } from './records'
import * as T from './template'

// Another call made this user's live one first (the one_live_practice index in assessment.model.ts).
class AlreadyMadeError extends Error {}

// A 'making' one younger than this is being filled by another call (another tab); an older one
// was left by a crash and no longer counts, so it never blocks the next try for good.
const MAKING_ABANDONED_MS = 60_000

const live = (user: SessionUser) => ({
  engineer: new Types.ObjectId(user.id),
  practice: 'live' as const,
})

async function liveReference(user: SessionUser): Promise<string | null> {
  const found = await AssessmentModel.findOne(live(user), 'reference').lean()
  return found?.reference ?? null
}

async function beingMade(user: SessionUser): Promise<boolean> {
  return !!(await AssessmentModel.exists({
    engineer: new Types.ObjectId(user.id),
    practice: 'making',
    createdAt: { $gt: new Date(Date.now() - MAKING_ABANDONED_MS) },
  }))
}

// The "removed" mark lives on the user's walkthrough record (user_settings.walkthroughs), a
// Mixed field another service owns, so only this one key is read and written here.
type WithWalkthroughs = { walkthroughs?: { practiceRemoved?: boolean } | null }
async function removedByUser(user: SessionUser): Promise<boolean> {
  const found = await UserSettingsModel.findOne({ user: user.id }, 'walkthroughs').lean()
  return (found as WithWalkthroughs | null)?.walkthroughs?.practiceRemoved === true
}

/** Returns the reference of this user's live practice assessment, making it on first sign-in; null if they removed it or it could not be made. */
export async function ensurePractice(user: SessionUser): Promise<string | null> {
  // Never throws: it runs inside the signed-in-user route, which must answer anyway.
  try {
    // The "removed" mark first: Remove saves it before it hides, so a call between its two
    // writes never hands out the one being hidden.
    if (await removedByUser(user)) return null
    const found = await liveReference(user)
    if (found) return found
    // Another call is filling one: no practice yet, rather than a half-made reference.
    if (await beingMade(user)) return null
    const made = await makePractice(user)
    // A Remove that saved its mark while this was being made: hide this one too, or it would
    // undo the Remove. Remove hides after its mark, so one of the two always catches it.
    if (await removedByUser(user)) {
      await AssessmentModel.updateMany(live(user), { $set: { practice: 'hidden' } })
      return null
    }
    return made
  } catch (error) {
    console.error(`Could not make the practice assessment for ${user.id}:`, error)
    return null
  }
}

/** Hides this user's practice assessment (if any) and makes a fresh one from the template; returns its reference. */
export async function setUpPractice(user: SessionUser): Promise<string> {
  await AssessmentModel.updateMany(live(user), { $set: { practice: 'hidden' } })
  await UserSettingsModel.updateOne(
    { user: user.id },
    { $unset: { 'walkthroughs.practiceRemoved': 1 } },
  )
  return makePractice(user)
}

/** Hides this user's practice assessment for good; nothing is deleted. Returns nothing. */
export async function removePractice(user: SessionUser): Promise<void> {
  // Without this, a null record would refuse the dotted $set below (Mongo can't set inside null).
  await UserSettingsModel.updateOne(
    { user: user.id, walkthroughs: null },
    { $unset: { walkthroughs: 1 } },
  )
  await UserSettingsModel.updateOne(
    { user: user.id },
    {
      $set: { 'walkthroughs.practiceRemoved': true },
      $setOnInsert: {
        user: user.id,
        metadata: {
          source_type: 'settings',
          jurisdiction: null,
          facility_type: null,
          COPE_dimension: null,
          effective_date: new Date(),
        },
      },
    },
    { upsert: true },
  )
  // Hidden after the mark is saved: in the other order, a sign-in between the two writes would
  // find no live one and no mark, and make a replacement (ensurePractice).
  await AssessmentModel.updateMany(live(user), { $set: { practice: 'hidden' } })
}

// Makes one from the template and returns its reference; when another call made one first,
// returns that one's instead.
async function makePractice(user: SessionUser): Promise<string> {
  try {
    return await build(user)
  } catch (error) {
    if (!(error instanceof AlreadyMadeError)) throw error
    const found = await liveReference(user)
    if (!found)
      throw new Error('The practice assessment made at the same moment has gone.', {
        cause: error,
      })
    return found
  }
}

// Every record of one practice assessment, in the order they depend on each other.
async function build(user: SessionUser): Promise<string> {
  const now = new Date()
  const ids = {
    assessment: new Types.ObjectId(),
    site: new Types.ObjectId(),
    client: new Types.ObjectId(),
  }
  const location = Object.fromEntries(T.LOCATIONS.map((l) => [l.ref, new Types.ObjectId()]))
  const day = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    return new Date(d.getTime() + offset * 86_400_000)
  }

  // a. The assessment first, as 'making': open to no one, listed nowhere and not handed out
  // until it is filled (below). Its own counter, so no RPT number is used up. Its `stage` is
  // left to MarshBot's re-check at the end (advanceStage, the one writer).
  const { reference } = await insertWithNextCode(
    'practice',
    (n) => `${PRACTICE_PREFIX}${pad(n)}`,
    (code) =>
      AssessmentModel.create({
        _id: ids.assessment,
        reference: code,
        site: ids.site,
        surveyType: 'First survey',
        siteVisitDate: day(-7),
        reportDueDate: day(14),
        siteContacts: T.SITE_CONTACTS,
        engineer: new Types.ObjectId(user.id),
        practice: 'making',
        reportStatus: 'draft',
        locations: T.LOCATIONS.map(({ ref, building, floor, name }) => ({
          _id: location[ref],
          building,
          floor,
          name,
          key: locationKey(name, floor, building),
        })),
      }),
  )
  try {
    await fillPractice(user, reference, ids, location, now)
    // Made live only once filled (after fillPractice's b. to g.). The one_live_practice index
    // stops a second call (another tab) here.
    await AssessmentModel.updateOne({ _id: ids.assessment }, { $set: { practice: 'live' } }).catch(
      (error: unknown) => {
        if (duplicateKeyField(error) === 'engineer') throw new AlreadyMadeError()
        throw error
      },
    )
  } catch (error) {
    // No transaction (dev and test MongoDB are standalone), so a failed or beaten make removes
    // what this call made. It was never live, so no one was handed it.
    await removeMade(ids).catch((cleanupError: unknown) =>
      console.error('Could not remove a half-made practice assessment:', cleanupError),
    )
    throw error
  }
  // h. MarshBot's brief and stage, by the real re-check (rule phrases, no AI: the thread's
  // wording runs only for an open Overview). This is creation, so it moves the stage from
  // Setup to what the data proves (Generate); a failure here leaves that to the next open.
  await refreshBrief(reference).catch((error: unknown) =>
    console.error(`MarshBot's first check of ${reference} failed:`, error),
  )
  return reference
}
