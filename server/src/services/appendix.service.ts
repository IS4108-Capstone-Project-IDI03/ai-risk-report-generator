// Appendix A "Site Photos" (GN-07): the engineer picks which of the report's
// photos it shows, in what order, under what caption. The export (EX-01) is to
// read the same list. Called by routes/assessment.routes.ts.
import { Types } from 'mongoose'
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel } from '../models/assessment.model'
import { AssessmentNotFoundError } from './capture-session.service'
import { listObservations } from './observation.service'
import { assessmentToDraft } from './section.service'

// The whole ordered list replaces the saved one, so one write covers choosing,
// removing, reordering and recaptioning (AC6, AC7, AC12). Caption limit as in
// assessment.model.ts.
export const appendixSchema = z.object({
  photos: z.array(z.object({ photoId: z.string(), caption: z.string().trim().max(200) })).max(200),
})

export class UnknownPhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownPhotoError'
  }
}

// One photo the appendix can show, with what tells it apart (AC10).
export type AppendixPhotoDto = {
  photoId: string
  observationId: string
  name: string
  url: string
  location: string | null
  category: string | null
  note: string | null
  selected: boolean
}

// The report's photos (AC5): those of its observations that are not deleted, as
// captured (listObservations already leaves out deleted ones and removed photos).
async function reportPhotos(reference: string) {
  return (await listObservations(reference)).reverse().flatMap((o) =>
    o.photos.map((p) => ({
      photoId: p.id,
      observationId: o.id,
      name: p.name,
      url: p.url,
      location: o.location && [o.location.name, o.location.floor].filter(Boolean).join(', '),
      // An observation can be filed under several categories; none when uncategorised.
      category: o.copeDimensions?.length ? o.copeDimensions.join(', ') : null,
      note: o.note,
    })),
  )
}

type ReportPhoto = Awaited<ReturnType<typeof reportPhotos>>[number]

function appendixOf(photos: ReportPhoto[], saved: { photo: Types.ObjectId; caption: string }[]) {
  const chosen = new Set(saved.map((s) => String(s.photo)))
  const byId = new Map(photos.map((p) => [p.photoId, p]))
  return {
    // A chosen photo whose observation was deleted since is no longer the
    // report's, so it drops out rather than showing a broken image.
    selected: saved.flatMap((s) => {
      const p = byId.get(String(s.photo))
      return p ? [{ ...p, caption: s.caption }] : []
    }),
    available: photos.map((p): AppendixPhotoDto => ({ ...p, selected: chosen.has(p.photoId) })),
  }
}

export async function getAppendix(reference: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'appendixPhotos').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return appendixOf(await reportPhotos(reference), assessment.appendixPhotos ?? [])
}

// Saves the appendix's photos in order. Only the assigned engineer can, while
// the assessment is not archived. Every photo must be one of the report's, and
// appear once, so the export never meets an id it cannot show.
export async function saveAppendix(
  reference: string,
  input: z.infer<typeof appendixSchema>,
  user: SessionUser,
) {
  const assessment = await assessmentToDraft(reference, user)
  const photos = await reportPhotos(reference)
  const known = new Set(photos.map((p) => p.photoId))
  const ids = input.photos.map((p) => p.photoId)
  if (ids.some((id) => !known.has(id))) {
    throw new UnknownPhotoError('A photo is not one of this report’s photos.')
  }
  if (new Set(ids).size !== ids.length) {
    throw new UnknownPhotoError('A photo is in the appendix twice.')
  }
  const saved = input.photos.map((p) => ({
    photo: new Types.ObjectId(p.photoId),
    caption: p.caption,
  }))
  await AssessmentModel.updateOne({ _id: assessment._id }, { $set: { appendixPhotos: saved } })
  return appendixOf(photos, saved)
}
