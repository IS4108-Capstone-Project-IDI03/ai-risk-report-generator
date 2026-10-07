import { z } from 'zod'
import { isValidObjectId } from 'mongoose'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import { AssessmentNotFoundError } from './capture-session.service'

export class LocationNotFoundError extends Error {
  constructor() {
    super('The location was not found.')
    this.name = 'LocationNotFoundError'
  }
}
export class LocationInUseError extends Error {
  constructor(name: string, count: number, deleted = 0) {
    super(
      `${name} has ${count} observation${count === 1 ? '' : 's'}${deleted ? `, ${deleted} of them deleted` : ''}. It can't be removed while they are saved there.`,
    )
    this.name = 'LocationInUseError'
  }
}
export class DuplicateLocationError extends Error {
  constructor() {
    super('This location is already on the list.')
    this.name = 'DuplicateLocationError'
  }
}

// Request body for POST /api/assessments/:reference/locations.
export const newLocationSchema = z.object({
  name: z
    .string('Name the location.')
    .trim()
    .min(1, 'Name the location.')
    .max(100, 'The name must be 100 characters or fewer.'),
  floor: z
    .string()
    .trim()
    .max(40, 'Floor must be 40 characters or fewer.')
    .optional()
    .transform((value) => value || undefined),
})
export type LocationDetails = z.infer<typeof newLocationSchema>

export type LocationDto = { id: string; name: string; floor: string | null }

export function locationKey(name: string, floor?: string) {
  return `${name.trim().toLowerCase()}|${floor?.trim().toLowerCase() ?? ''}`
}

export function toLocationDto(l: ILocation): LocationDto {
  return { id: String(l._id), name: l.name, floor: l.floor ?? null }
}

// The assessment's locations, in the order they were added.
export async function listLocations(reference: string): Promise<LocationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return (assessment.locations ?? []).map(toLocationDto)
}

// Adds a location unless one with the same name and floor exists. Matching on
// the key in the same update makes it atomic, so two taps cannot add two.
export async function addLocation(
  reference: string,
  details: LocationDetails,
): Promise<LocationDto> {
  const key = locationKey(details.name, details.floor)
  const assessment = await AssessmentModel.findOneAndUpdate(
    { reference, 'locations.key': { $ne: key } },
    { $push: { locations: { ...details, key } } },
    { returnDocument: 'after', projection: 'locations' },
  ).lean()
  if (!assessment) {
    if (await AssessmentModel.exists({ reference })) throw new DuplicateLocationError()
    throw new AssessmentNotFoundError(reference)
  }
  return toLocationDto(assessment.locations.at(-1)!)
}

// Removes a location added by mistake. One with observations stays, so no
// observation loses where it was captured. Deleted observations count too
// (CP-08), so a restored one never comes back without its location.
// ponytail: an observation saved or moved here between the check and the
// removal would keep a location that is gone; it then shows no location until
// its tags are edited (CP-06).
export async function removeLocation(reference: string, id: string) {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  const location = isValidObjectId(id)
    ? assessment.locations?.find((l) => l._id.equals(id))
    : undefined
  if (!location) throw new LocationNotFoundError()
  const there = { assessment: assessment._id, location: location._id }
  const [count, deleted] = await Promise.all([
    ObservationModel.countDocuments(there),
    ObservationModel.countDocuments({ ...there, deleted: { $exists: true } }),
  ])
  if (count) throw new LocationInUseError(location.name, count, deleted)
  await AssessmentModel.updateOne({ _id: assessment._id }, { $pull: { locations: { _id: id } } })
}
