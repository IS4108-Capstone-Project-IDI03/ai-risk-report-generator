import { z } from 'zod'
import { isValidObjectId } from 'mongoose'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { ObservationModel } from '../models/observation.model'
import type { SessionUser } from './auth.service'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'

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

// A blank optional field is left out.
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => value || undefined)

// A level it recognises in its standard spelling, so "L2", "lvl 2" and "2nd
// floor" are all one level, Level 2; "B1" is Basement 1 and "GF" Ground. Any
// other name, e.g. Podium, is kept as given. The client spells levels the same
// way (standardLevel in locations.ts) and asks before saving one it doesn't
// recognise.
export function standardLevel(level: string): string {
  const l = level.trim().toLowerCase().replace(/\s+/g, ' ')
  let m = /^(?:basement|b) ?(\d+)$/.exec(l)
  if (m) return 'Basement ' + Number(m[1])
  if (l === 'basement') return 'Basement'
  if (/^(?:lower ground|lg)$/.test(l)) return 'Lower ground'
  if (/^(?:ground|ground floor|g|gf)$/.test(l)) return 'Ground'
  if (/^(?:upper ground|ug)$/.test(l)) return 'Upper ground'
  if (/^(?:mezzanine|mezz)$/.test(l)) return 'Mezzanine'
  if (/^(?:roof|rooftop|roof level)$/.test(l)) return 'Roof'
  m =
    /^(?:level|lvl|l|floor|storey) ?(\d+)$/.exec(l) ?? /^(\d+)(?:st|nd|rd|th)?(?: floor)?$/.exec(l)
  if (m) return 'Level ' + Number(m[1])
  return level.trim()
}

// Request body for POST /api/assessments/:reference/locations and PATCH
// /api/assessments/:reference/locations/:id (CP-16): a location in a building,
// with an optional level, or one elsewhere on site, with a name only.
export const locationSchema = z
  .object({
    building: optionalText(100, 'The building must be 100 characters or fewer.'),
    floor: optionalText(40, 'The level must be 40 characters or fewer.').transform(
      (level) => level && standardLevel(level),
    ),
    name: z
      .string('Name the location.')
      .trim()
      .min(1, 'Name the location.')
      .max(100, 'The name must be 100 characters or fewer.'),
  })
  .refine((l) => !l.floor || l.building, {
    message: 'Only a location in a building has a level.',
    path: ['floor'],
  })
export type LocationDetails = z.infer<typeof locationSchema>

export type LocationDto = {
  id: string
  building: string | null
  floor: string | null
  name: string
}

// The building is added only when there is one, so a location saved before
// CP-16 keeps its key.
export function locationKey(name: string, floor?: string, building?: string) {
  const key = `${name.trim().toLowerCase()}|${floor?.trim().toLowerCase() ?? ''}`
  return building?.trim() ? `${key}|${building.trim().toLowerCase()}` : key
}

export function toLocationDto(l: ILocation): LocationDto {
  return { id: String(l._id), building: l.building ?? null, floor: l.floor ?? null, name: l.name }
}

// Where an observation was made, as the report words it: most specific first,
// "Staircase, Level 2, Block A". One with no building reads "Pump room, B1" as
// before CP-16, so the drafts that hold it (report_sections evidence) still
// compare equal.
export function locationText(l: { name: string; floor?: string | null; building?: string | null }) {
  return [l.name, l.floor, l.building].filter(Boolean).join(', ')
}

// The building and level as already listed, whatever their case, so "block a"
// joins "Block A".
function listedSpelling(listed: ILocation[], details: LocationDetails): LocationDetails {
  const same = (a?: string) => (b?: string) => !!a && a.toLowerCase() === b?.toLowerCase()
  return {
    ...details,
    building: listed.map((l) => l.building).find(same(details.building)) ?? details.building,
    floor: listed.map((l) => l.floor).find(same(details.floor)) ?? details.floor,
  }
}

// The assessment's locations, in the order they were added.
export async function listLocations(reference: string): Promise<LocationDto[]> {
  const assessment = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  return (assessment.locations ?? []).map(toLocationDto)
}

// Adds a location unless one with the same name, level and building exists.
// Matching on the key in the same update makes it atomic, so two taps cannot
// add two.
export async function addLocation(
  reference: string,
  details: LocationDetails,
): Promise<LocationDto> {
  const listed = await AssessmentModel.findOne({ reference }, 'locations').lean()
  if (!listed) throw new AssessmentNotFoundError(reference)
  const location = listedSpelling(listed.locations ?? [], details)
  const key = locationKey(location.name, location.floor, location.building)
  const assessment = await AssessmentModel.findOneAndUpdate(
    { _id: listed._id, 'locations.key': { $ne: key } },
    { $push: { locations: { ...location, key } } },
    { returnDocument: 'after', projection: 'locations' },
  ).lean()
  if (!assessment) {
    if (await AssessmentModel.exists({ _id: listed._id })) throw new DuplicateLocationError()
    throw new AssessmentNotFoundError(reference)
  }
  return toLocationDto(assessment.locations.at(-1)!)
}

// Changes a location's building, level or name in place (CP-16). Observations
// store its id, so every one saved there follows it. Only the assessment's
// assigned engineer can, as for its observations (CP-08), and not once it is
// archived. Refused when another location already has those details; the key
// check is in the same update, so two edits cannot make a pair.
export async function editLocation(
  reference: string,
  id: string,
  details: LocationDetails,
  user: SessionUser,
): Promise<LocationDto> {
  const assessment = await AssessmentModel.findOne(
    { reference },
    'engineer archivedAt locations',
  ).lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError(
      'Only the engineer assigned to this assessment can change its locations.',
    )
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  const locations = assessment.locations ?? []
  const current = isValidObjectId(id) ? locations.find((l) => l._id.equals(id)) : undefined
  if (!current) throw new LocationNotFoundError()
  const others = locations.filter((l) => l !== current)
  const location = listedSpelling(others, details)
  const key = locationKey(location.name, location.floor, location.building)
  const at = 'locations.$[here]'
  const set: Record<string, string> = { [`${at}.name`]: location.name, [`${at}.key`]: key }
  const unset: Record<string, 1> = {}
  for (const field of ['building', 'floor'] as const) {
    if (location[field]) set[`${at}.${field}`] = location[field]
    else unset[`${at}.${field}`] = 1
  }
  const updated = await AssessmentModel.findOneAndUpdate(
    {
      _id: assessment._id,
      locations: { $not: { $elemMatch: { key, _id: { $ne: current._id } } } },
    },
    { $set: set, ...(Object.keys(unset).length && { $unset: unset }) },
    {
      arrayFilters: [{ 'here._id': current._id }],
      returnDocument: 'after',
      projection: 'locations',
    },
  ).lean()
  const saved = updated?.locations?.find((l) => l._id.equals(current._id))
  if (saved) return toLocationDto(saved)
  if (await AssessmentModel.exists({ _id: assessment._id, 'locations._id': current._id }))
    throw new DuplicateLocationError()
  throw new LocationNotFoundError()
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
  if (count) throw new LocationInUseError(locationText(location), count, deleted)
  await AssessmentModel.updateOne({ _id: assessment._id }, { $pull: { locations: { _id: id } } })
}
